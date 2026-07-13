import type { LogLevel, Permission } from '@desk-agent/plugin-sdk';
import { parseSensorEvent, type SensorEventName } from '@desk-agent/protocol';
import type { Config } from './configLoader.js';
import type { PluginSpec } from './workerHost.js';
import type { AutomationRule } from './automationEngine.js';
import type { WorkerHost } from './workerHost.js';
import type { WsGateway } from './wsGateway.js';
import type { TunnelSupervisor } from './tunnelSupervisor.js';
import type { EventBus } from './eventBus.js';
import type { AutomationEngine } from './automationEngine.js';
import type { Watchdog } from './watchdog.js';
import type { PresenceEngine, PresenceEngineConfig } from './presenceEngine.js';

export interface PluginRegistryEntry {
  modulePath: string;
  permissions: Permission[];
  // Names the top-level Config field this plugin's instance config lives
  // under (e.g. 'weather' -> config.weather). Omitted for plugins that need
  // no external config (system-stats, energy-saver).
  configKey?: keyof Config;
}

export function buildPluginSpecs(
  config: Config,
  registry: Record<string, PluginRegistryEntry>,
  onLog: (level: LogLevel, message: string) => void,
): PluginSpec[] {
  const specs: PluginSpec[] = [];
  for (const id of config.enabledPlugins) {
    const entry = registry[id];
    if (!entry) {
      onLog('error', `enabled plugin "${id}" not found in registry, skipping`);
      continue;
    }
    specs.push({
      id,
      modulePath: entry.modulePath,
      permissions: entry.permissions,
      config: entry.configKey ? config[entry.configKey] : undefined,
    });
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
    {
      id: 'wake-on-return',
      eventName: 'presence.returned',
      condition: () => config.presence.wakeEnabled,
      debounceMs: 0,
      action: { pluginId: 'energy-saver', action: 'wake-display' },
    },
  ];
}

export function buildPresenceEngineConfig(config: Config): PresenceEngineConfig {
  return {
    absenceTimeoutMs: config.presence.absenceTimeoutMs,
    gazeIsKeepAwake: config.presence.gazeIsKeepAwake,
    bootConfirmationTimeoutMs: config.presence.bootConfirmationTimeoutMs,
  };
}

export interface BootDeps {
  workerHost: WorkerHost;
  gateway: WsGateway;
  tunnelSupervisor: TunnelSupervisor;
  eventBus: EventBus;
  automationEngine: AutomationEngine;
  watchdog?: Watchdog;
  presenceEngine?: PresenceEngine;
  onLog?: (level: LogLevel, message: string) => void;
}

export function boot(deps: BootDeps) {
  const onLog = deps.onLog ?? (() => {});
  deps.eventBus.subscribe('person_present', (payload) => deps.automationEngine.handleEvent(payload.eventName, payload.data));
  deps.eventBus.subscribe('presence.returned', (payload) => deps.automationEngine.handleEvent(payload.eventName, payload.data));
  deps.eventBus.subscribe('automation.override', (payload) => deps.automationEngine.setEnabled(Boolean(payload.data.enabled)));
  if (deps.presenceEngine) {
    const engine = deps.presenceEngine;
    const subscribeSensor = (eventName: SensorEventName, handle: (data: any) => void) => {
      deps.eventBus.subscribe(eventName, (payload) => {
        const result = parseSensorEvent(eventName, payload.data);
        if (!result.ok) {
          onLog('error', `dropped malformed ${eventName} payload: ${result.error}`);
          return;
        }
        handle(result.value.data);
      });
    };
    subscribeSensor('sensor.face_visible', (data) => engine.onFaceVisible(data.visible));
    subscribeSensor('sensor.gaze_at_screen', (data) => engine.onGaze(data.gazing));
    subscribeSensor('sensor.motion', (data) => engine.onMotion(data.active));
    subscribeSensor('sensor.camera_state', (data) => engine.onCameraState(data.state, data.reason));
  }
  deps.tunnelSupervisor.start();
  deps.gateway.start();
  deps.watchdog?.start();
}
