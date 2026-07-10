import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig } from './configLoader.js';
import { buildPluginSpecs, buildAutomationRules, boot, type PluginRegistryEntry } from './entrypoint.js';
import { EventBus } from './eventBus.js';
import { AutomationEngine } from './automationEngine.js';
import { WorkerHost } from './workerHost.js';
import { WsGateway } from './wsGateway.js';
import { TunnelSupervisor } from './tunnelSupervisor.js';
import { createRealAdbRunner } from './adbRunner.js';
import { Watchdog } from './watchdog.js';

const require = createRequire(import.meta.url);

// The phone only sends sporadic frames (a `hello` once on connect, and
// `event.publish` on manual toggle taps) — there's no periodic client-side
// ping today. 30s tolerates that sporadic cadence without false-flagging a
// live-but-idle phone. Full heartbeat-driven fidelity would need a
// client-side ping the app doesn't send yet; out of scope for this fix.
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

  const workerHost = new WorkerHost(specs, {
    maxOldGenerationSizeMb: 128,
    maxRestarts: 5,
    callTimeoutMs: 3000,
    onLog: log,
    onEventPublish: (raw) => eventBus.publish(raw),
    onWidgetPublish: (widgetId, widget) => gateway.broadcastWidgetUpdate(widgetId, widget as any),
  });

  const watchdog = new Watchdog(WATCHDOG_TIMEOUT_MS, () => log('watchdog', 'error', 'phone appears to have stopped sending heartbeats'));

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
    onClientMessage: () => watchdog.pulse(),
  });

  const tunnelSupervisor = new TunnelSupervisor(createRealAdbRunner(), config.wsPort, (level, message) => log('tunnel', level, message));

  workerHost.start().then(() => boot({ workerHost, gateway, tunnelSupervisor, eventBus, automationEngine, watchdog }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
