import { describe, it, expect, vi } from 'vitest';
import { buildPluginSpecs, buildAutomationRules, boot, EventBus, AutomationEngine, Watchdog } from './index.js';
import type { Config } from './index.js';

describe('buildPluginSpecs', () => {
  it('maps enabled plugin ids through the registry', () => {
    const config: Config = {
      enabledPlugins: ['weather'],
      weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'],
      presenceDebounceMs: 30000,
      wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true },
    };
    const registry = { weather: { modulePath: '/pkg/weather/dist/index.js', permissions: ['net:api.weather' as const] } };
    const specs = buildPluginSpecs(config, registry, vi.fn());
    expect(specs).toEqual([{ id: 'weather', modulePath: '/pkg/weather/dist/index.js', permissions: ['net:api.weather'] }]);
  });

  it('logs and skips an enabled plugin id missing from the registry, never throwing', () => {
    const config: Config = {
      enabledPlugins: ['unknown-plugin'],
      weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'],
      presenceDebounceMs: 30000,
      wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true },
    };
    const onLog = vi.fn();
    const specs = buildPluginSpecs(config, {}, onLog);
    expect(specs).toEqual([]);
    expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('unknown-plugin'));
  });

  it('attaches the config slice named by the registry entry\'s configKey', () => {
    const config: Config = {
      enabledPlugins: ['weather'],
      weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'],
      presenceDebounceMs: 30000,
      wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true },
    };
    const registry = {
      weather: { modulePath: '/pkg/weather/dist/index.js', permissions: ['net:api.weather' as const], configKey: 'weather' as const },
    };
    const specs = buildPluginSpecs(config, registry, vi.fn());
    expect(specs[0].config).toEqual({ location: 'Seattle', intervalMs: 600_000 });
  });

  it('leaves config undefined for a registry entry with no configKey', () => {
    const config: Config = {
      enabledPlugins: ['system-stats'],
      weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'],
      presenceDebounceMs: 30000,
      wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true },
    };
    const registry = { 'system-stats': { modulePath: '/pkg/system-stats/dist/index.js', permissions: ['sys:read-stats' as const] } };
    const specs = buildPluginSpecs(config, registry, vi.fn());
    expect(specs[0].config).toBeUndefined();
  });
});

describe('buildAutomationRules', () => {
  it('builds the sleep-on-absent rule debounced by config.presenceDebounceMs', () => {
    const config: Config = {
      enabledPlugins: [], weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 45000, wsPort: 8787, launchAppOnDock: true, presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true },
    };
    const rules = buildAutomationRules(config);
    const sleepRule = rules.find((r) => r.id === 'sleep-on-absent')!;
    expect(sleepRule.debounceMs).toBe(45000);
    expect(sleepRule.condition({ present: false })).toBe(true);
    expect(sleepRule.condition({ present: true })).toBe(false);
    expect(sleepRule.action).toEqual({ pluginId: 'energy-saver', action: 'sleep-display' });
  });
});

describe('buildAutomationRules — wake-on-return', () => {
  it('builds the wake-on-return rule with zero debounce, targeting presence.returned', () => {
    const config: Config = {
      enabledPlugins: [], weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 45000, wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true },
    };
    const rules = buildAutomationRules(config);
    expect(rules).toHaveLength(2);
    const wakeRule = rules.find((r) => r.id === 'wake-on-return')!;
    expect(wakeRule).toBeDefined();
    expect(wakeRule.eventName).toBe('presence.returned');
    expect(wakeRule.debounceMs).toBe(0);
    expect(wakeRule.action).toEqual({ pluginId: 'energy-saver', action: 'wake-display' });
  });

  it('wake-on-return condition is true when presence.wakeEnabled is true', () => {
    const config: Config = {
      enabledPlugins: [], weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 45000, wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true },
    };
    const rules = buildAutomationRules(config);
    const wakeRule = rules.find((r) => r.id === 'wake-on-return')!;
    expect(wakeRule.condition({})).toBe(true);
  });

  it('wake-on-return condition is false when presence.wakeEnabled is false', () => {
    const config: Config = {
      enabledPlugins: [], weather: { location: 'Seattle', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 45000, wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: false },
    };
    const rules = buildAutomationRules(config);
    const wakeRule = rules.find((r) => r.id === 'wake-on-return')!;
    expect(wakeRule.condition({})).toBe(false);
  });
});

function makeMinimalBootDeps() {
  const eventBus = new EventBus();
  const automationEngine = new AutomationEngine([], { invoke: vi.fn() }, vi.fn());
  const workerHost = { start: vi.fn(), getWidgets: vi.fn(), invokeAction: vi.fn(), getStatus: vi.fn() } as any;
  const gateway = { start: vi.fn(), broadcastWidgetUpdate: vi.fn() } as any;
  const tunnelSupervisor = { start: vi.fn() } as any;
  return { workerHost, gateway, tunnelSupervisor, eventBus, automationEngine };
}

describe('boot', () => {
  it('starts the watchdog when one is provided', () => {
    const deps = makeMinimalBootDeps();
    const watchdog = new Watchdog(30000, vi.fn());
    const startSpy = vi.spyOn(watchdog, 'start');
    boot({ ...deps, watchdog });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when no watchdog is provided (backward compatible)', () => {
    const deps = makeMinimalBootDeps();
    expect(() => boot(deps)).not.toThrow();
  });

  it('still wires tunnel supervisor and gateway startup regardless of watchdog', () => {
    const deps = makeMinimalBootDeps();
    boot(deps);
    expect(deps.tunnelSupervisor.start).toHaveBeenCalledTimes(1);
    expect(deps.gateway.start).toHaveBeenCalledTimes(1);
  });

  it('routes presence.returned events to automationEngine.handleEvent', () => {
    const deps = makeMinimalBootDeps();
    const handleEventSpy = vi.spyOn(deps.automationEngine, 'handleEvent');
    boot(deps);
    deps.eventBus.publish({ eventName: 'presence.returned', data: {} });
    expect(handleEventSpy).toHaveBeenCalledWith('presence.returned', {});
  });
});

import { buildPresenceEngineConfig } from './index.js';

describe('buildPresenceEngineConfig', () => {
  it('maps config.presence fields into a PresenceEngineConfig', () => {
    const config: Config = {
      enabledPlugins: [], weather: { location: 'x', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 30000, wsPort: 8787, launchAppOnDock: true,
      presence: { absenceTimeoutMs: 111, gazeIsKeepAwake: false, bootConfirmationTimeoutMs: 333, wakeEnabled: true },
    };
    expect(buildPresenceEngineConfig(config)).toEqual({ absenceTimeoutMs: 111, gazeIsKeepAwake: false, bootConfirmationTimeoutMs: 333 });
  });
});

describe('boot with presenceEngine', () => {
  it('does not throw when no presenceEngine is provided (backward compatible)', () => {
    const deps = makeMinimalBootDeps();
    expect(() => boot(deps)).not.toThrow();
  });

  it('routes all four sensor.* events to the presence engine', () => {
    const deps = makeMinimalBootDeps();
    const presenceEngine = { onFaceVisible: vi.fn(), onGaze: vi.fn(), onMotion: vi.fn(), onCameraState: vi.fn() } as any;
    boot({ ...deps, presenceEngine });
    deps.eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: true } });
    deps.eventBus.publish({ eventName: 'sensor.gaze_at_screen', data: { gazing: true } });
    deps.eventBus.publish({ eventName: 'sensor.motion', data: { active: false } });
    deps.eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'error', reason: 'x' } });
    expect(presenceEngine.onFaceVisible).toHaveBeenCalledWith(true);
    expect(presenceEngine.onGaze).toHaveBeenCalledWith(true);
    expect(presenceEngine.onMotion).toHaveBeenCalledWith(false);
    expect(presenceEngine.onCameraState).toHaveBeenCalledWith('error', 'x');
  });

  it('validates sensor.camera_state payload via parseSensorEvent and drops a malformed state enum without ever calling the presence engine', () => {
    const deps = makeMinimalBootDeps();
    const presenceEngine = { onFaceVisible: vi.fn(), onGaze: vi.fn(), onMotion: vi.fn(), onCameraState: vi.fn() } as any;
    const onLog = vi.fn();
    boot({ ...deps, presenceEngine, onLog });
    deps.eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'sleeping' } });
    expect(presenceEngine.onCameraState).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('sensor.camera_state'));
  });

  it('validates sensor.face_visible payload and drops a malformed (non-boolean) visible field without calling the presence engine', () => {
    const deps = makeMinimalBootDeps();
    const presenceEngine = { onFaceVisible: vi.fn(), onGaze: vi.fn(), onMotion: vi.fn(), onCameraState: vi.fn() } as any;
    const onLog = vi.fn();
    boot({ ...deps, presenceEngine, onLog });
    deps.eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: 'yes' } });
    expect(presenceEngine.onFaceVisible).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('sensor.face_visible'));
  });

  it('still routes valid sensor.* payloads to the presence engine when onLog is provided (no regression)', () => {
    const deps = makeMinimalBootDeps();
    const presenceEngine = { onFaceVisible: vi.fn(), onGaze: vi.fn(), onMotion: vi.fn(), onCameraState: vi.fn() } as any;
    const onLog = vi.fn();
    boot({ ...deps, presenceEngine, onLog });
    deps.eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: true } });
    deps.eventBus.publish({ eventName: 'sensor.gaze_at_screen', data: { gazing: true } });
    deps.eventBus.publish({ eventName: 'sensor.motion', data: { active: false } });
    deps.eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'active' } });
    expect(presenceEngine.onFaceVisible).toHaveBeenCalledWith(true);
    expect(presenceEngine.onGaze).toHaveBeenCalledWith(true);
    expect(presenceEngine.onMotion).toHaveBeenCalledWith(false);
    expect(presenceEngine.onCameraState).toHaveBeenCalledWith('active', undefined);
    expect(onLog).not.toHaveBeenCalled();
  });
});
