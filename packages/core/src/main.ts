import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig } from './configLoader.js';
import { buildPluginSpecs, buildAutomationRules, buildPresenceEngineConfig, boot, type PluginRegistryEntry } from './entrypoint.js';
import { EventBus } from './eventBus.js';
import { AutomationEngine } from './automationEngine.js';
import { PresenceEngine } from './presenceEngine.js';
import { WorkerHost } from './workerHost.js';
import { WsGateway } from './wsGateway.js';
import { TunnelSupervisor } from './tunnelSupervisor.js';
import { createRealAdbRunner } from './adbRunner.js';
import { Watchdog } from './watchdog.js';

const require = createRequire(import.meta.url);

// The phone now acks every server heartbeat (WsGateway broadcasts one every
// `heartbeatMs` = 5000ms; see app/src/wsClient.ts's onmessage handler),
// independent of sensor-edge activity -- this is what makes the watchdog
// safe to use as a genuine link-liveness signal even during a real, quiet
// absence (edge-only sensor emission legitimately produces zero traffic
// once a signal has settled). 30s gives a comfortable ~6x margin over that
// 5s ack cadence before concluding the link is actually dead.
const WATCHDOG_TIMEOUT_MS = 30000;

function resolvePluginRegistry(): Record<string, PluginRegistryEntry> {
  return {
    'system-stats': { modulePath: require.resolve('@desk-agent/plugin-system-stats'), permissions: ['sys:read-stats'] },
    'weather': { modulePath: require.resolve('@desk-agent/plugin-weather'), permissions: ['net:api.weather'] },
    'energy-saver': { modulePath: require.resolve('@desk-agent/plugin-energy-saver'), permissions: ['sys:control-display'] },
  };
}

export function run() {
  const configPath = process.env.DESK_AGENT_CONFIG_PATH ?? path.join(process.cwd(), 'config.json');
  const config = loadConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));

  const log = (pluginId: string, level: string, message: string) => console.log(`[${level}] ${pluginId}: ${message}`);
  const specs = buildPluginSpecs(config, resolvePluginRegistry(), (level, message) => log('core', level, message));

  const eventBus = new EventBus();
  const automationEngine = new AutomationEngine(buildAutomationRules(config), {
    invoke: (pluginId, action, args) => workerHost.invokeAction(pluginId, action, args),
  }, (level, message) => log('automation', level, message));

  const presenceEngine = new PresenceEngine(
    buildPresenceEngineConfig(config),
    (present) => eventBus.publish({ eventName: 'person_present', data: { present } }),
    (level, message) => log('presence', level, message),
  );

  const workerHost = new WorkerHost(specs, {
    maxOldGenerationSizeMb: 128,
    maxRestarts: 5,
    callTimeoutMs: 3000,
    onLog: log,
    onEventPublish: (raw) => eventBus.publish(raw),
    onWidgetPublish: (widgetId, widget) => gateway.broadcastWidgetUpdate(widgetId, widget as any),
  });

  const watchdog = new Watchdog(WATCHDOG_TIMEOUT_MS, () => {
    log('watchdog', 'error', 'phone appears to have stopped sending heartbeats');
    presenceEngine.onCameraState('error', 'watchdog-timeout');
  });

  const gateway = new WsGateway({
    port: config.wsPort,
    heartbeatMs: 5000,
    getSnapshot: async () => {
      const entries = await Promise.all(specs.map(async (spec) => {
        const widgets = await workerHost.getWidgets(spec.id);
        return widgets.map((widget) => ({ widgetId: spec.id, widget }));
      }));
      return entries.flat();
    },
    onEventPublish: (raw) => eventBus.publish(raw),
    onClientMessage: () => {
      watchdog.pulse();
      // Any fresh client traffic proves the link is alive again, healing a
      // watchdog-triggered fail-to-present without waiting for the phone to
      // fully reconnect and re-announce camera_state('active') (see
      // presenceEngine.ts's onLinkResumed doc comment for why that wait was
      // a bug: a phone that merely paused sending, then resumed over the
      // SAME still-open socket, never re-announces).
      presenceEngine.onLinkResumed();
    },
  });

  const tunnelSupervisor = new TunnelSupervisor(createRealAdbRunner(), config.wsPort, (level, message) => log('tunnel', level, message));

  workerHost.start().then(() => boot({
    workerHost, gateway, tunnelSupervisor, eventBus, automationEngine, watchdog, presenceEngine,
    onLog: (level, message) => log('core', level, message),
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
