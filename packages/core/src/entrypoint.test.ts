import { describe, it, expect, vi } from 'vitest';
import { buildPluginSpecs, buildAutomationRules, boot, EventBus, AutomationEngine, Watchdog } from './index.js';
import type { Config } from './index.js';

describe('buildPluginSpecs', () => {
  it('maps enabled plugin ids through the registry', () => {
    const config: Config = {
      enabledPlugins: ['weather'],
      weather: { apiKey: 'k', location: 'Seattle' },
      presenceDebounceMs: 30000,
      wsPort: 8787,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000 },
    };
    const registry = { weather: { modulePath: '/pkg/weather/dist/index.js', permissions: ['net:api.weather' as const] } };
    const specs = buildPluginSpecs(config, registry, vi.fn());
    expect(specs).toEqual([{ id: 'weather', modulePath: '/pkg/weather/dist/index.js', permissions: ['net:api.weather'] }]);
  });

  it('logs and skips an enabled plugin id missing from the registry, never throwing', () => {
    const config: Config = {
      enabledPlugins: ['unknown-plugin'],
      weather: { apiKey: 'k', location: 'Seattle' },
      presenceDebounceMs: 30000,
      wsPort: 8787,
      presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000 },
    };
    const onLog = vi.fn();
    const specs = buildPluginSpecs(config, {}, onLog);
    expect(specs).toEqual([]);
    expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('unknown-plugin'));
  });
});

describe('buildAutomationRules', () => {
  it('builds the sleep-on-absent rule debounced by config.presenceDebounceMs', () => {
    const config: Config = {
      enabledPlugins: [], weather: { apiKey: 'k', location: 'Seattle' }, presenceDebounceMs: 45000, wsPort: 8787, presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000 },
    };
    const rules = buildAutomationRules(config);
    expect(rules).toHaveLength(1);
    expect(rules[0].debounceMs).toBe(45000);
    expect(rules[0].condition({ present: false })).toBe(true);
    expect(rules[0].condition({ present: true })).toBe(false);
    expect(rules[0].action).toEqual({ pluginId: 'energy-saver', action: 'sleep-display' });
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
});

import { buildPresenceEngineConfig } from './index.js';

describe('buildPresenceEngineConfig', () => {
  it('maps config.presence fields into a PresenceEngineConfig', () => {
    const config: Config = {
      enabledPlugins: [], weather: { apiKey: 'k', location: 'x' }, presenceDebounceMs: 30000, wsPort: 8787,
      presence: { absenceTimeoutMs: 111, gazeIsKeepAwake: false, bootConfirmationTimeoutMs: 333 },
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
