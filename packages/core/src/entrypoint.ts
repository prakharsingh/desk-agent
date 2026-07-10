import type { Permission } from '@desk-agent/plugin-sdk';
import type { Config } from './configLoader.js';
import type { PluginSpec } from './workerHost.js';
import type { AutomationRule } from './automationEngine.js';
import type { WorkerHost } from './workerHost.js';
import type { WsGateway } from './wsGateway.js';
import type { TunnelSupervisor } from './tunnelSupervisor.js';
import type { EventBus } from './eventBus.js';
import type { AutomationEngine } from './automationEngine.js';
import type { Watchdog } from './watchdog.js';

export interface PluginRegistryEntry {
  modulePath: string;
  permissions: Permission[];
}

export function buildPluginSpecs(
  config: Config,
  registry: Record<string, PluginRegistryEntry>,
  onLog: (level: string, message: string) => void,
): PluginSpec[] {
  const specs: PluginSpec[] = [];
  for (const id of config.enabledPlugins) {
    const entry = registry[id];
    if (!entry) {
      onLog('error', `enabled plugin "${id}" not found in registry, skipping`);
      continue;
    }
    specs.push({ id, modulePath: entry.modulePath, permissions: entry.permissions });
  }
  return specs;
}

export function buildAutomationRules(config: Config): AutomationRule[] {
  return [
    {
      id: 'sleep-on-absent',
      eventName: 'person_present',
      condition: (data) => data.present === false,
      debounceMs: config.presenceDebounceMs,
      action: { pluginId: 'energy-saver', action: 'sleep-display' },
    },
  ];
}

export interface BootDeps {
  workerHost: WorkerHost;
  gateway: WsGateway;
  tunnelSupervisor: TunnelSupervisor;
  eventBus: EventBus;
  automationEngine: AutomationEngine;
  watchdog?: Watchdog;
}

export function boot(deps: BootDeps) {
  deps.eventBus.subscribe('person_present', (payload) => deps.automationEngine.handleEvent(payload.eventName, payload.data));
  deps.eventBus.subscribe('automation.override', (payload) => deps.automationEngine.setEnabled(Boolean(payload.data.enabled)));
  deps.tunnelSupervisor.start();
  deps.gateway.start();
  deps.watchdog?.start();
}
