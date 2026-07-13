import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  EventBus, AutomationEngine, WorkerHost, WsGateway, TunnelSupervisor,
  buildAutomationRules, boot, PresenceEngine, buildPresenceEngineConfig,
} from './index.js';
import type { WorkerLike, WsClientLike, WsServerLike, AdbRunner, PluginSpec, Config } from './index.js';

class FakeWorker extends EventEmitter implements WorkerLike {
  postMessage = vi.fn((msg: any) => {
    if (msg.kind === 'getWidgets') {
      this.emit('message', { kind: 'getWidgetsResult', requestId: msg.requestId, widgets: [{ type: 'system-stats', props: { cpuPercent: 1, ramPercent: 2, battery: 'N/A', nowPlaying: 'unavailable' } }] });
    }
  });
  async terminate() { this.emit('exit', 1); return 1; }
}

// A slower fake worker used to prove the atomic-snapshot guarantee: its
// getWidgets reply is delayed via setTimeout (advanced under fake timers),
// so a test can assert that the gateway withholds the `hello` reply until
// this plugin's widgets have arrived too -- not just the fast plugin's.
class DelayedFakeWorker extends EventEmitter implements WorkerLike {
  constructor(private delayMs: number) { super(); }
  postMessage = vi.fn((msg: any) => {
    if (msg.kind === 'getWidgets') {
      setTimeout(() => {
        this.emit('message', { kind: 'getWidgetsResult', requestId: msg.requestId, widgets: [{ type: 'power-mode', props: { mode: 'balanced' } }] });
      }, this.delayMs);
    }
  });
  async terminate() { this.emit('exit', 1); return 1; }
}

class FakeWsClient extends EventEmitter implements WsClientLike {
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
}

class FakeWsServer extends EventEmitter implements WsServerLike {
  close() {}
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('full integration loop', () => {
  it('runs startup -> hello snapshot -> widget update -> presence event -> sleep action', async () => {
    // Two enabled plugins on a SINGLE WorkerHost, mirroring the real
    // main.ts topology (one WorkerHost across all enabled plugin specs).
    // energy-saver's fake worker is deliberately slower than system-stats'
    // so the test can prove the getSnapshot Promise.all composition in
    // main.ts is atomic: the client must not see a reply until BOTH
    // plugins' getWidgets() calls have resolved.
    const spec: PluginSpec = { id: 'system-stats', modulePath: '/fake', permissions: ['sys:read-stats'] };
    const energySaverSpec: PluginSpec = { id: 'energy-saver', modulePath: '/fake', permissions: ['sys:control-display'] };
    const specs = [spec, energySaverSpec];
    let fakeWorker!: FakeWorker;
    let energyWorker!: DelayedFakeWorker;
    let eventBus!: EventBus;
    let gateway!: WsGateway;
    const ENERGY_DELAY_MS = 500;
    const workerHost = new WorkerHost(specs, {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 2000,
      onLog: vi.fn(),
      onEventPublish: (raw) => eventBus.publish(raw),
      onWidgetPublish: (widgetId, widget) => gateway.broadcastWidgetUpdate(widgetId, widget as any),
      createWorker: (s) => {
        if (s.id === 'energy-saver') { energyWorker = new DelayedFakeWorker(ENERGY_DELAY_MS); return energyWorker; }
        fakeWorker = new FakeWorker();
        return fakeWorker;
      },
    });
    await workerHost.start();
    fakeWorker.emit('message', { kind: 'ready' });
    energyWorker.emit('message', { kind: 'ready' });

    const wsServer = new FakeWsServer();
    gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      // Mirrors main.ts's getSnapshot: Promise.all across all enabled
      // plugin specs, each awaiting its own workerHost.getWidgets() call,
      // before the entries are flattened and sent in one reply.
      getSnapshot: async () => {
        const entries = await Promise.all(specs.map(async (s) => {
          const widgets = await workerHost.getWidgets(s.id);
          return widgets.map((widget) => ({ widgetId: s.id, widget }));
        }));
        return entries.flat();
      },
      onEventPublish: (raw) => eventBus.publish(raw),
      wssFactory: () => wsServer,
    });

    const invokedActions: Array<{ pluginId: string; action: string }> = [];
    const config: Config = { enabledPlugins: [], weather: { location: 'x', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 1000, wsPort: 8787, presence: { absenceTimeoutMs: 300000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 300000, wakeEnabled: true } };
    const automationEngine = new AutomationEngine(buildAutomationRules(config), {
      invoke: (pluginId, action) => { invokedActions.push({ pluginId, action }); workerHost.invokeAction(pluginId, action); },
    }, vi.fn());

    eventBus = new EventBus();
    const adb: AdbRunner = { reverse: vi.fn(async () => {}), trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p1' }); return { stop: vi.fn() }; } };
    const tunnelSupervisor = new TunnelSupervisor(adb, 8787, vi.fn());

    boot({ workerHost, gateway, tunnelSupervisor, eventBus, automationEngine });

    expect(adb.reverse).toHaveBeenCalledWith(8787, 8787);

    const client = new FakeWsClient();
    wsServer.emit('connection', client);
    const { createFrame } = await import('@desk-agent/protocol');
    client.emit('message', JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));

    // system-stats replies synchronously (on the same tick), but the
    // gateway must NOT reply yet because energy-saver's response is still
    // pending -- this is the atomicity guarantee from the spec's Data Flow
    // section: the host awaits ALL enabled plugins' getWidgets() before
    // replying to hello.
    await vi.advanceTimersByTimeAsync(0);
    expect(client.sent.length).toBe(0);

    // Advance up to (but not past) the energy-saver worker's delay: still
    // no reply should have been sent.
    await vi.advanceTimersByTimeAsync(ENERGY_DELAY_MS - 1);
    expect(client.sent.length).toBe(0);

    // Now let energy-saver's delayed getWidgetsResult land.
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(client.sent.length).toBe(1));

    const snapshotFrame = JSON.parse(client.sent[0]);
    const widgetIds = snapshotFrame.payload.widgets.map((entry: any) => entry.widgetId);
    expect(widgetIds).toContain('system-stats');
    expect(widgetIds).toContain('energy-saver');
    expect(snapshotFrame.payload.widgets).toHaveLength(2);

    client.emit('message', JSON.stringify(createFrame('event.publish', { eventName: 'person_present', data: { present: false } })));
    await vi.advanceTimersByTimeAsync(1000);
    expect(invokedActions).toEqual([{ pluginId: 'energy-saver', action: 'sleep-display' }]);
    expect(energyWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'onAction', action: 'sleep-display' }));
  });

  it('simulates a plugin crash-and-restart without dropping the host', async () => {
    let spawnCount = 0;
    const spec: PluginSpec = { id: 'system-stats', modulePath: '/fake', permissions: ['sys:read-stats'] };
    const host = new WorkerHost([spec], {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 2000,
      onLog: vi.fn(), onEventPublish: vi.fn(), onWidgetPublish: vi.fn(),
      createWorker: () => {
        spawnCount++;
        const w = new FakeWorker();
        if (spawnCount === 1) {
          // Mimic real node:worker_threads behavior (see workerHost.test.ts):
          // an uncaught exception emits 'error' followed by 'exit' with a
          // non-zero code, both for the same crash. WorkerHost only triggers
          // a restart from the 'exit' handler, so both must be emitted here.
          queueMicrotask(() => {
            w.emit('error', new Error('boom'));
            w.emit('exit', 1);
          });
        }
        return w;
      },
    });
    await host.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(spawnCount).toBe(2);
    expect(host.getStatus('system-stats')).toBe('starting');
  });

  it('simulates tunnel-down/reconnect: adb reverse re-issued after detach then attach', () => {
    let handler: ((event: { type: 'attach' | 'detach'; serial: string }) => void) | undefined;
    const adb: AdbRunner = {
      reverse: vi.fn(async () => {}),
      trackDevices: (onEvent) => { handler = onEvent; return { stop: vi.fn() }; },
    };
    const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
    supervisor.start();
    handler?.({ type: 'attach', serial: 'p1' });
    handler?.({ type: 'detach', serial: 'p1' });
    handler?.({ type: 'attach', serial: 'p1' });
    expect(adb.reverse).toHaveBeenCalledTimes(2);
  });

  it('drives sleep-display through sensor events -> PresenceEngine -> automation (Slice 1b path)', async () => {
    const spec: PluginSpec = { id: 'energy-saver', modulePath: '/fake', permissions: ['sys:control-display'] };
    let fakeWorker!: FakeWorker;
    let eventBus!: EventBus;
    const workerHost = new WorkerHost([spec], {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 2000,
      onLog: vi.fn(), onEventPublish: (raw) => eventBus.publish(raw), onWidgetPublish: vi.fn(),
      createWorker: () => { fakeWorker = new FakeWorker(); return fakeWorker; },
    });
    await workerHost.start();
    fakeWorker.emit('message', { kind: 'ready' });

    const invokedActions: Array<{ pluginId: string; action: string }> = [];
    const config: Config = {
      enabledPlugins: [], weather: { location: 'x', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 1000, wsPort: 8787,
      presence: { absenceTimeoutMs: 2000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 2000, wakeEnabled: true },
    };
    const automationEngine = new AutomationEngine(buildAutomationRules(config), {
      invoke: (pluginId, action) => { invokedActions.push({ pluginId, action }); workerHost.invokeAction(pluginId, action); },
    }, vi.fn());

    eventBus = new EventBus();
    const presenceEngine = new PresenceEngine(
      buildPresenceEngineConfig(config),
      (present) => eventBus.publish({ eventName: 'person_present', data: { present } }),
      vi.fn(),
    );

    const tunnelSupervisor = { start: vi.fn() } as any;
    const gateway = { start: vi.fn(), broadcastWidgetUpdate: vi.fn() } as any;
    boot({ workerHost, gateway, tunnelSupervisor, eventBus, automationEngine, presenceEngine });

    eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'active' } });
    eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: false } });
    eventBus.publish({ eventName: 'sensor.motion', data: { active: false } });

    // absenceTimeoutMs (2000) then presenceDebounceMs (1000) = 3000ms total.
    await vi.advanceTimersByTimeAsync(3000);
    expect(invokedActions).toEqual([{ pluginId: 'energy-saver', action: 'sleep-display' }]);
  });

  it('never invokes sleep-display when the camera reports an error mid-window (fail-to-present)', async () => {
    const spec: PluginSpec = { id: 'energy-saver', modulePath: '/fake', permissions: ['sys:control-display'] };
    let fakeWorker!: FakeWorker;
    let eventBus!: EventBus;
    const workerHost = new WorkerHost([spec], {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 2000,
      onLog: vi.fn(), onEventPublish: (raw) => eventBus.publish(raw), onWidgetPublish: vi.fn(),
      createWorker: () => { fakeWorker = new FakeWorker(); return fakeWorker; },
    });
    await workerHost.start();
    fakeWorker.emit('message', { kind: 'ready' });

    const invokedActions: Array<{ pluginId: string; action: string }> = [];
    const config: Config = {
      enabledPlugins: [], weather: { location: 'x', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 1000, wsPort: 8787,
      presence: { absenceTimeoutMs: 2000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 2000, wakeEnabled: true },
    };
    const automationEngine = new AutomationEngine(buildAutomationRules(config), {
      invoke: (pluginId, action) => { invokedActions.push({ pluginId, action }); workerHost.invokeAction(pluginId, action); },
    }, vi.fn());

    eventBus = new EventBus();
    const presenceEngine = new PresenceEngine(
      buildPresenceEngineConfig(config),
      (present) => eventBus.publish({ eventName: 'person_present', data: { present } }),
      vi.fn(),
    );

    const tunnelSupervisor = { start: vi.fn() } as any;
    const gateway = { start: vi.fn(), broadcastWidgetUpdate: vi.fn() } as any;
    boot({ workerHost, gateway, tunnelSupervisor, eventBus, automationEngine, presenceEngine });

    eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'active' } });
    eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: false } });
    eventBus.publish({ eventName: 'sensor.motion', data: { active: false } });
    await vi.advanceTimersByTimeAsync(1000);

    // Simulates main.ts's Watchdog.onMissed -> presenceEngine.onCameraState wiring (Task A6).
    eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'error', reason: 'watchdog-timeout' } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(invokedActions).toEqual([]);
  });

  it('drives wake-display through a genuine sensor return -> PresenceEngine.onGenuineReturn -> presence.returned -> automation (Slice 1c path)', async () => {
    const spec: PluginSpec = { id: 'energy-saver', modulePath: '/fake', permissions: ['sys:control-display'] };
    let fakeWorker!: FakeWorker;
    let eventBus!: EventBus;
    const workerHost = new WorkerHost([spec], {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 2000,
      onLog: vi.fn(), onEventPublish: (raw) => eventBus.publish(raw), onWidgetPublish: vi.fn(),
      createWorker: () => { fakeWorker = new FakeWorker(); return fakeWorker; },
    });
    await workerHost.start();
    fakeWorker.emit('message', { kind: 'ready' });

    const invokedActions: Array<{ pluginId: string; action: string }> = [];
    const config: Config = {
      enabledPlugins: [], weather: { location: 'x', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 1000, wsPort: 8787,
      presence: { absenceTimeoutMs: 2000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 2000, wakeEnabled: true },
    };
    const automationEngine = new AutomationEngine(buildAutomationRules(config), {
      invoke: (pluginId, action) => { invokedActions.push({ pluginId, action }); workerHost.invokeAction(pluginId, action); },
    }, vi.fn());

    eventBus = new EventBus();
    // Mirrors main.ts's exact PresenceEngine construction, including the
    // new 4th onGenuineReturn argument wired to presence.returned.
    const presenceEngine = new PresenceEngine(
      buildPresenceEngineConfig(config),
      (present) => eventBus.publish({ eventName: 'person_present', data: { present } }),
      vi.fn(),
      () => eventBus.publish({ eventName: 'presence.returned', data: {} }),
    );

    const tunnelSupervisor = { start: vi.fn() } as any;
    const gateway = { start: vi.fn(), broadcastWidgetUpdate: vi.fn() } as any;
    boot({ workerHost, gateway, tunnelSupervisor, eventBus, automationEngine, presenceEngine });

    // Drive the engine to absent first (mirrors the sleep-path test), then
    // trigger a genuine return.
    eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'active' } });
    eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: false } });
    eventBus.publish({ eventName: 'sensor.motion', data: { active: false } });
    await vi.advanceTimersByTimeAsync(3000); // absenceTimeoutMs (2000) + presenceDebounceMs (1000)
    expect(invokedActions).toEqual([{ pluginId: 'energy-saver', action: 'sleep-display' }]);

    invokedActions.length = 0; // isolate the wake assertion below

    eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: true } });
    await vi.advanceTimersByTimeAsync(0); // wake-on-return has debounceMs: 0
    expect(invokedActions).toEqual([{ pluginId: 'energy-saver', action: 'wake-display' }]);
    expect(fakeWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'onAction', action: 'wake-display' }));
  });

  it('never invokes wake-display when a camera error forces present -- fail-safe present must not be mistaken for a genuine return', async () => {
    const spec: PluginSpec = { id: 'energy-saver', modulePath: '/fake', permissions: ['sys:control-display'] };
    let fakeWorker!: FakeWorker;
    let eventBus!: EventBus;
    const workerHost = new WorkerHost([spec], {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 2000,
      onLog: vi.fn(), onEventPublish: (raw) => eventBus.publish(raw), onWidgetPublish: vi.fn(),
      createWorker: () => { fakeWorker = new FakeWorker(); return fakeWorker; },
    });
    await workerHost.start();
    fakeWorker.emit('message', { kind: 'ready' });

    const invokedActions: Array<{ pluginId: string; action: string }> = [];
    const config: Config = {
      enabledPlugins: [], weather: { location: 'x', intervalMs: 600_000 }, systemStats: { pollIntervalMs: 2000 }, energySaver: { idleAction: 'displaysleepnow' }, watchdogTimeoutMs: 30000, visibleWidgets: ['clock', 'system', 'weather', 'presence', 'playing', 'light'], presenceDebounceMs: 1000, wsPort: 8787,
      presence: { absenceTimeoutMs: 2000, gazeIsKeepAwake: true, bootConfirmationTimeoutMs: 2000, wakeEnabled: true },
    };
    const automationEngine = new AutomationEngine(buildAutomationRules(config), {
      invoke: (pluginId, action) => { invokedActions.push({ pluginId, action }); workerHost.invokeAction(pluginId, action); },
    }, vi.fn());

    eventBus = new EventBus();
    const presenceEngine = new PresenceEngine(
      buildPresenceEngineConfig(config),
      (present) => eventBus.publish({ eventName: 'person_present', data: { present } }),
      vi.fn(),
      () => eventBus.publish({ eventName: 'presence.returned', data: {} }),
    );

    const tunnelSupervisor = { start: vi.fn() } as any;
    const gateway = { start: vi.fn(), broadcastWidgetUpdate: vi.fn() } as any;
    boot({ workerHost, gateway, tunnelSupervisor, eventBus, automationEngine, presenceEngine });

    // Get into maybe-absent (same setup as the existing fail-to-present
    // test), then force a camera error -- this calls onPresenceChange(true)
    // (sleep-on-absent's condition is unaffected either way, since it only
    // fires on present:false) but must NOT call onGenuineReturn.
    eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'active' } });
    eventBus.publish({ eventName: 'sensor.face_visible', data: { visible: false } });
    eventBus.publish({ eventName: 'sensor.motion', data: { active: false } });
    await vi.advanceTimersByTimeAsync(1000);

    eventBus.publish({ eventName: 'sensor.camera_state', data: { state: 'error', reason: 'watchdog-timeout' } });
    await vi.advanceTimersByTimeAsync(5000);

    expect(invokedActions).toEqual([]);
  });
});
