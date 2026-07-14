import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlChannel } from './controlChannel.js';
import type { ToApp, ToCore, ControlTransport } from './controlChannel.js';
import type { AutomationRuleView } from './automationEngine.js';

class FakeTransport implements ControlTransport {
  sent: ToApp[] = [];
  private handler?: (msg: ToCore) => void;
  postMessage(msg: ToApp) {
    this.sent.push(msg);
  }
  onMessage(handler: (msg: ToCore) => void) {
    this.handler = handler;
  }
  receive(msg: ToCore) {
    this.handler?.(msg);
  }
}

type TestDeps = ReturnType<typeof buildBaseDeps> & { transport: FakeTransport };

function buildBaseDeps() {
  return {
    gateway: {
      getClientCount: vi.fn(() => 0),
      getLastHelloAt: vi.fn((): number | null => null),
      sendScreensaverConfig: vi.fn(),
    },
    phoneDisplay: { getStatus: vi.fn((): { enabled: boolean; graceMs: number } | null => null) },
    tunnelSupervisor: {
      getStatus: vi.fn(() => ({
        serial: null as string | null,
        tunnelStatus: 'idle' as const,
        lastReissueAt: null as number | null,
        launchAppOnDock: true,
        appLaunchStatus: 'idle' as const,
        lastAppLaunchAt: null as number | null,
      })),
      reissue: vi.fn(async () => {}),
      launchApp: vi.fn(async () => {}),
      setLaunchAppOnDock: vi.fn(),
    },
    presenceEngine: { getState: vi.fn(() => 'present' as const), getStateSince: vi.fn(() => 1000) },
    automationEngine: {
      isEnabled: vi.fn(() => true),
      getRules: vi.fn((): AutomationRuleView[] => []),
      setEnabled: vi.fn(),
      setRuleEnabled: vi.fn(),
    },
    wsPort: 8787,
    watchdogTimeoutMs: 30000,
    pluginPermissions: { 'system-stats': ['sys:read-stats' as const] },
    enabledPlugins: ['system-stats'],
    snapshotIntervalMs: 5000,
  };
}

function makeDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  return { ...buildBaseDeps(), transport: new FakeTransport(), ...overrides };
}

function makeChannel(deps: TestDeps) {
  return new ControlChannel(deps as any);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ControlChannel', () => {
  it('pushes an initial snapshot on construction', () => {
    const deps = makeDeps();
    makeChannel(deps);
    expect(deps.transport.sent).toHaveLength(1);
    expect(deps.transport.sent[0].kind).toBe('snapshot');
  });

  it('builds a snapshot reflecting every injected dependency', () => {
    const deps = makeDeps();
    makeChannel(deps);
    const snap = (deps.transport.sent[0] as Extract<ToApp, { kind: 'snapshot' }>).data;
    expect(snap.core).toEqual({ uptimeMs: 0, wsPort: 8787, watchdogTimeoutMs: 30000 });
    expect(snap.device).toEqual({
      serial: null,
      tunnelStatus: 'idle',
      lastReissueAt: null,
      launchAppOnDock: true,
      appLaunchStatus: 'idle',
      lastAppLaunchAt: null,
    });
    expect(snap.clients).toEqual({ connected: 0, lastHelloAt: null });
    expect(snap.presence).toEqual({ state: 'present', since: 1000 });
    expect(snap.plugins).toEqual({ 'system-stats': { enabled: true, permissions: ['sys:read-stats'] } });
    expect(snap.automation).toEqual({ enabled: true, rules: [] });
    expect(snap.denialsToday).toBe(0);
  });

  it('uptimeMs reflects elapsed time since construction', () => {
    const deps = makeDeps();
    makeChannel(deps);
    vi.advanceTimersByTime(1500);
    deps.transport.receive({ kind: 'getSnapshot' });
    const snap = (deps.transport.sent.at(-1) as Extract<ToApp, { kind: 'snapshot' }>).data;
    expect(snap.core.uptimeMs).toBe(1500);
  });

  it('a plugin absent from enabledPlugins reports enabled: false', () => {
    const deps = makeDeps({ enabledPlugins: [] });
    makeChannel(deps);
    const snap = (deps.transport.sent[0] as Extract<ToApp, { kind: 'snapshot' }>).data;
    expect(snap.plugins['system-stats'].enabled).toBe(false);
  });

  it('getSnapshot request pushes a fresh snapshot', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'getSnapshot' });
    expect(deps.transport.sent).toHaveLength(2);
  });

  it('reissueTunnel calls tunnelSupervisor.reissue()', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'reissueTunnel' });
    expect(deps.tunnelSupervisor.reissue).toHaveBeenCalledTimes(1);
  });

  it('launchApp calls tunnelSupervisor.launchApp()', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'launchApp' });
    expect(deps.tunnelSupervisor.launchApp).toHaveBeenCalledTimes(1);
  });

  it('launchApp pushes an updated snapshot once tunnelSupervisor.launchApp() resolves, so the Device pane sees the real result instead of waiting for the next periodic tick', async () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'launchApp' });
    expect(deps.transport.sent).toHaveLength(1); // no push yet -- launchApp() hasn't resolved
    await (deps.tunnelSupervisor.launchApp as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(deps.transport.sent).toHaveLength(2);
  });

  it('setLaunchAppOnDock calls through and pushes an updated snapshot', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'setLaunchAppOnDock', enabled: false });
    expect(deps.tunnelSupervisor.setLaunchAppOnDock).toHaveBeenCalledWith(false);
    expect(deps.transport.sent).toHaveLength(2);
  });

  it('setAutomationEnabled calls through and pushes an updated snapshot', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'setAutomationEnabled', enabled: false });
    expect(deps.automationEngine.setEnabled).toHaveBeenCalledWith(false);
    expect(deps.transport.sent).toHaveLength(2);
  });

  it('setRuleEnabled calls through with the rule id and pushes an updated snapshot', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'setRuleEnabled', ruleId: 'sleep-on-absent', enabled: false });
    expect(deps.automationEngine.setRuleEnabled).toHaveBeenCalledWith('sleep-on-absent', false);
    expect(deps.transport.sent).toHaveLength(2);
  });

  it('recordDenial increments denialsToday and pushes an updated snapshot', () => {
    const deps = makeDeps();
    const channel = makeChannel(deps);
    channel.recordDenial();
    channel.recordDenial();
    const snap = (deps.transport.sent.at(-1) as Extract<ToApp, { kind: 'snapshot' }>).data;
    expect(snap.denialsToday).toBe(2);
    expect(deps.transport.sent).toHaveLength(3); // initial + 2 pushes
  });

  it('pushSnapshot() (for external wiring, e.g. presence onStateChange) pushes on demand', () => {
    const deps = makeDeps();
    const channel = makeChannel(deps);
    channel.pushSnapshot();
    expect(deps.transport.sent).toHaveLength(2);
  });

  it('pushes a fresh snapshot periodically, on snapshotIntervalMs, to catch changes with no dedicated push wiring (e.g. device attach/detach, client connect)', () => {
    const deps = makeDeps({ snapshotIntervalMs: 5000 });
    makeChannel(deps);
    vi.advanceTimersByTime(4999);
    expect(deps.transport.sent).toHaveLength(1); // just the initial push
    vi.advanceTimersByTime(1);
    expect(deps.transport.sent).toHaveLength(2);
  });

  it('stop() clears the periodic timer', () => {
    const deps = makeDeps({ snapshotIntervalMs: 5000 });
    const channel = makeChannel(deps);
    channel.stop();
    vi.advanceTimersByTime(20000);
    expect(deps.transport.sent).toHaveLength(1); // no further periodic pushes
  });

  it('a log forwarded via forwardLog is sent to the transport as a log message, stamped with ts', () => {
    const deps = makeDeps();
    const channel = makeChannel(deps);
    channel.forwardLog('presence', 'info', 'presence forced to present: active');
    const logMsg = deps.transport.sent.find((m: ToApp) => m.kind === 'log') as Extract<ToApp, { kind: 'log' }>;
    expect(logMsg.entry).toEqual({ ts: expect.any(Number), level: 'info', source: 'presence', message: 'presence forced to present: active' });
  });

  it('builds a snapshot including the phone-reported screensaver config', () => {
    const deps = makeDeps({ phoneDisplay: { getStatus: vi.fn(() => ({ enabled: false, graceMs: 60000 })) } });
    makeChannel(deps);
    const snap = (deps.transport.sent[0] as Extract<ToApp, { kind: 'snapshot' }>).data;
    expect(snap.screensaver).toEqual({ enabled: false, graceMs: 60000 });
  });

  it('screensaver is null in the snapshot before the phone has ever reported', () => {
    const deps = makeDeps();
    makeChannel(deps);
    const snap = (deps.transport.sent[0] as Extract<ToApp, { kind: 'snapshot' }>).data;
    expect(snap.screensaver).toBeNull();
  });

  it('setScreensaverConfig calls gateway.sendScreensaverConfig with the given config', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'setScreensaverConfig', enabled: false, graceMs: 60000 });
    expect(deps.gateway.sendScreensaverConfig).toHaveBeenCalledWith({ enabled: false, graceMs: 60000 });
  });

  it('setScreensaverConfig does NOT push an optimistic snapshot -- the Mac only sees the phone-confirmed value on its next report', () => {
    const deps = makeDeps();
    makeChannel(deps);
    deps.transport.receive({ kind: 'setScreensaverConfig', enabled: false, graceMs: 60000 });
    expect(deps.transport.sent).toHaveLength(1); // just the initial snapshot, no extra push
  });
});
