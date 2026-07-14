import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfigFromFile } from './configLoader.js';
import { buildPluginSpecs, buildAutomationRules, buildPresenceEngineConfig, boot, type PluginRegistryEntry } from './entrypoint.js';
import { EventBus } from './eventBus.js';
import { AutomationEngine } from './automationEngine.js';
import { PresenceEngine } from './presenceEngine.js';
import { WorkerHost } from './workerHost.js';
import { WsGateway } from './wsGateway.js';
import { TunnelSupervisor } from './tunnelSupervisor.js';
import { createRealAdbRunner } from './adbRunner.js';
import { Watchdog } from './watchdog.js';
import { ControlChannel, type ControlTransport } from './controlChannel.js';
import { ScreensaverConfigStore } from './screensaverConfigStore.js';

const require = createRequire(import.meta.url);

function resolvePluginRegistry(): Record<string, PluginRegistryEntry> {
  return {
    'system-stats': { modulePath: require.resolve('@desk-agent/plugin-system-stats'), permissions: ['sys:read-stats', 'sys:control-media'] },
    'weather': { modulePath: require.resolve('@desk-agent/plugin-weather'), permissions: ['net:api.weather'], configKey: 'weather' },
    'energy-saver': { modulePath: require.resolve('@desk-agent/plugin-energy-saver'), permissions: ['sys:control-display'] },
  };
}

export interface RunOptions {
  // Only supplied when hosted by the Electron app (apps/mac/src/main/coreHost.ts).
  // Standalone `node` launches (SETUP.md's manual path, and every test in this
  // package) pass none, so no ControlChannel is ever constructed and this file's
  // only change in that path is the extra (unused) log-forwarding closure below.
  transport?: ControlTransport;
}

export function run(opts: RunOptions = {}) {
  const configPath = process.env.DESK_AGENT_CONFIG_PATH ?? path.join(process.cwd(), 'config.json');
  const config = loadConfigFromFile(configPath);
  const pluginRegistry = resolvePluginRegistry();

  // Declared before construction and assigned after (forward reference): the
  // log/denial/presence closures below are only ever INVOKED later, at
  // runtime, by which point controlChannel has been assigned -- same pattern
  // this file already used for workerHost/gateway forward references.
  let controlChannel: ControlChannel | undefined;

  const log = (pluginId: string, level: 'info' | 'warn' | 'error', message: string) => {
    console.log(`[${level}] ${pluginId}: ${message}`);
    controlChannel?.forwardLog(pluginId, level, message);
  };
  const specs = buildPluginSpecs(config, pluginRegistry, (level, message) => log('core', level, message));

  const eventBus = new EventBus();
  const automationEngine = new AutomationEngine(buildAutomationRules(config), {
    invoke: (pluginId, action, args) => workerHost.invokeAction(pluginId, action, args),
  }, (level, message) => log('automation', level, message));

  const presenceEngine = new PresenceEngine(
    buildPresenceEngineConfig(config),
    (present) => eventBus.publish({ eventName: 'person_present', data: { present } }),
    (level, message) => log('presence', level, message),
    () => eventBus.publish({ eventName: 'presence.returned', data: {} }),
    () => controlChannel?.pushSnapshot(),
  );

  const screensaverConfigStore = new ScreensaverConfigStore(() => controlChannel?.pushSnapshot());

  const workerHost = new WorkerHost(specs, {
    maxOldGenerationSizeMb: 128,
    maxRestarts: 5,
    callTimeoutMs: 3000,
    onLog: log,
    onEventPublish: (raw) => eventBus.publish(raw),
    onWidgetPublish: (widgetId, widget) => gateway.broadcastWidgetUpdate(widgetId, widget as any),
    onDenial: () => controlChannel?.recordDenial(),
  });

  // config.watchdogTimeoutMs's default (30000ms) rationale: the phone now
  // acks every server heartbeat (WsGateway broadcasts one every
  // `heartbeatMs` = 5000ms; see app/src/wsClient.ts's onmessage handler),
  // independent of sensor-edge activity -- this is what makes the watchdog
  // safe to use as a genuine link-liveness signal even during a real, quiet
  // absence (edge-only sensor emission legitimately produces zero traffic
  // once a signal has settled). The default gives a comfortable ~6x margin
  // over that 5s ack cadence before concluding the link is actually dead.
  const watchdog = new Watchdog(config.watchdogTimeoutMs, () => {
    log('watchdog', 'error', 'phone appears to have stopped sending heartbeats');
    presenceEngine.onCameraState('error', 'watchdog-timeout');
  });

  const gateway = new WsGateway({
    port: config.wsPort,
    heartbeatMs: 5000,
    onLog: (level, message) => log('gateway', level, message),
    getSnapshot: async () => {
      const entries = await Promise.all(specs.map(async (spec) => {
        const widgets = await workerHost.getWidgets(spec.id);
        return widgets.map((widget) => ({ widgetId: spec.id, widget }));
      }));
      return entries.flat();
    },
    getVisibleWidgets: () => config.visibleWidgets,
    onEventPublish: (raw) => eventBus.publish(raw),
    onActionInvoke: (pluginId, action, args) => workerHost.invokeAction(pluginId, action, args),
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

  const tunnelLog = (level: 'info' | 'warn' | 'error', message: string) => log('tunnel', level, message);
  const tunnelSupervisor = new TunnelSupervisor(createRealAdbRunner(tunnelLog), config.wsPort, tunnelLog, config.launchAppOnDock);

  if (opts.transport) {
    const pluginPermissions = Object.fromEntries(Object.entries(pluginRegistry).map(([id, entry]) => [id, entry.permissions]));
    controlChannel = new ControlChannel({
      transport: opts.transport,
      gateway,
      tunnelSupervisor,
      presenceEngine,
      automationEngine,
      phoneDisplay: screensaverConfigStore,
      wsPort: config.wsPort,
      watchdogTimeoutMs: config.watchdogTimeoutMs,
      pluginPermissions,
      enabledPlugins: config.enabledPlugins,
    });
  }

  workerHost.start().then(() => boot({
    workerHost, gateway, tunnelSupervisor, eventBus, automationEngine, watchdog, presenceEngine,
    screensaverConfigStore,
    onLog: (level, message) => log('core', level, message),
  })).catch((err) => {
    log('core', 'error', `startup failed: ${String(err)}`);
    process.exit(1);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
