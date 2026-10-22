import { describe, it, expect, vi } from 'vitest';
import type { DisplaySessionPayload } from '@desk-agent/protocol';
import { DisplayCoordinator, DISPLAY_ERROR_REASONS, DISPLAY_DEVICE_WAIT_MS, type DisplayCoordinatorDeps } from './displayCoordinator.js';
import { TunnelSupervisor, type AdbRunner, type PortOutcome } from './tunnelSupervisor.js';

function makeDeps(overrides: Partial<DisplayCoordinatorDeps> = {}) {
  const calls: string[] = [];
  const toApp = {
    notifyDisplayStartRequest: vi.fn(),
    notifyDisplayStopRequest: vi.fn(),
  };
  const base = {
    toApp,
    broadcast: vi.fn((p: DisplaySessionPayload) => { calls.push(`broadcast:${p.state}`); }),
    getSerial: vi.fn((): string | null => 'phone1'),
    tunnel: {
      addPort: vi.fn(async (port: number) => {
        await Promise.resolve();
        calls.push(`addPort:${port}:resolved`);
        return true;
      }),
      removePort: vi.fn((port: number) => { calls.push(`removePort:${port}`); }),
      waitForPort: vi.fn(async (_port: number, _timeoutMs: number): Promise<PortOutcome> => 'up'),
      waitForSerial: vi.fn(async (_timeoutMs: number): Promise<string | null> => 'phone1'),
    },
    deliverToken: vi.fn(async () => {}),
    setSleepSuppressed: vi.fn((s: boolean) => { calls.push(`suppress:${s}`); }),
    recheckPresence: vi.fn(() => { calls.push('recheck'); }),
    onLog: vi.fn(),
  };
  // Overrides replace whole deps (e.g. toApp: null); typed as the mock shape for assertions.
  const deps = { ...base, ...overrides } as typeof base;
  return { deps, toApp, calls };
}

const START = { w: 2340, h: 1080, orientation: 'landscape' as const, dpi: 402 };
const ACTIVE = { active: true, sessionId: 's1', videoPort: 8788 };

describe('DisplayCoordinator', () => {
  it('answers unsupported-host when running standalone', () => {
    const { deps } = makeDeps({ toApp: null });
    new DisplayCoordinator(deps).onPhoneStart(START);
    expect(deps.broadcast).toHaveBeenCalledWith({ state: 'error', sessionId: null, reason: 'unsupported-host' });
  });

  it('answers no-device when no phone serial is known', () => {
    const { deps, toApp } = makeDeps({ getSerial: () => null });
    new DisplayCoordinator(deps).onPhoneStart(START);
    expect(deps.broadcast).toHaveBeenCalledWith({ state: 'error', sessionId: null, reason: 'no-device' });
    expect(toApp.notifyDisplayStartRequest).not.toHaveBeenCalled();
  });

  it('forwards a start request with the device serial', () => {
    const { deps, toApp } = makeDeps();
    new DisplayCoordinator(deps).onPhoneStart(START);
    expect(toApp.notifyDisplayStartRequest).toHaveBeenCalledWith({ w: 2340, h: 1080, orientation: 'landscape', deviceSerial: 'phone1', dpi: 402 });
    expect(deps.broadcast).not.toHaveBeenCalled();
  });

  it('omits dpi from the start request when the phone did not send one', () => {
    const { deps, toApp } = makeDeps();
    new DisplayCoordinator(deps).onPhoneStart({ w: 1080, h: 2340, orientation: 'portrait' });
    expect(toApp.notifyDisplayStartRequest).toHaveBeenCalledWith({ w: 1080, h: 2340, orientation: 'portrait', deviceSerial: 'phone1' });
  });

  it('delivers the token via adb and never broadcasts or logs it', async () => {
    const { deps } = makeDeps();
    const c = new DisplayCoordinator(deps);
    await c.onDisplayToken({ sessionId: 's1', token: 'tok123' });
    expect(deps.deliverToken).toHaveBeenCalledWith('phone1', 's1', 'tok123');
    expect(JSON.stringify([deps.broadcast.mock.calls, deps.onLog.mock.calls])).not.toContain('tok123');
  });

  it('asks main to stop when token delivery fails', async () => {
    const { deps, toApp } = makeDeps({ deliverToken: vi.fn(async () => { throw new Error('adb shell failed for tok123'); }) });
    const c = new DisplayCoordinator(deps);
    await expect(c.onDisplayToken({ sessionId: 's1', token: 'tok123' })).resolves.toBeUndefined();
    expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'token-delivery-failed' });
    expect(JSON.stringify([deps.broadcast.mock.calls, deps.onLog.mock.calls])).not.toContain('tok123');
  });

  it('asks main to stop when the phone is gone before the token arrives', async () => {
    const { deps, toApp } = makeDeps({ getSerial: () => null });
    deps.tunnel.waitForSerial.mockResolvedValue(null);
    await new DisplayCoordinator(deps).onDisplayToken({ sessionId: 's1', token: 'tok123' });
    expect(deps.deliverToken).not.toHaveBeenCalled();
    expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'token-delivery-failed' });
  });

  it('suppresses sleep and opens the video tunnel before broadcasting ready', async () => {
    const { deps, calls } = makeDeps();
    await new DisplayCoordinator(deps).onDisplaySession(ACTIVE);
    expect(calls).toEqual(['suppress:true', 'addPort:8788:resolved', 'broadcast:ready']);
    expect(deps.broadcast).toHaveBeenCalledWith({ state: 'ready', sessionId: 's1', videoPort: 8788 });
  });

  describe('video port readiness (real TunnelSupervisor, fake adb)', () => {
    function withTunnel(reverseImpl: (port: number) => Promise<void> = async () => {}) {
      let emit!: (e: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void;
      const adb: AdbRunner = {
        reverse: vi.fn((l: number) => reverseImpl(l)),
        removeReverse: vi.fn(async () => {}),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        trackDevices: (onEvent) => { emit = onEvent; return { stop: vi.fn() }; },
      };
      const tunnel = new TunnelSupervisor(adb, 8787, vi.fn(), false);
      tunnel.start();
      const { deps, toApp } = makeDeps({ tunnel, getSerial: () => tunnel.getSerial() } as Partial<DisplayCoordinatorDeps>);
      return { deps, toApp, tunnel, adb, attach: () => emit({ type: 'attach', serial: 'phone1' }) };
    }

    it('a resync before any device attached waits, then broadcasts ready once the reverse lands (no stop)', async () => {
      vi.useFakeTimers();
      try {
        const { deps, toApp, adb, attach } = withTunnel();
        const c = new DisplayCoordinator(deps);
        const pending = c.onDisplaySession(ACTIVE); // core restart: serial still null
        await vi.advanceTimersByTimeAsync(3_000);
        expect(deps.broadcast).not.toHaveBeenCalled();
        expect(toApp.notifyDisplayStopRequest).not.toHaveBeenCalled();
        attach();
        await pending;
        expect(adb.reverse).toHaveBeenCalledWith(8788, 8788, 'phone1');
        expect(deps.broadcast).toHaveBeenCalledWith({ state: 'ready', sessionId: 's1', videoPort: 8788 });
        expect(toApp.notifyDisplayStopRequest).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it(`stops with no-device when no device attaches within ${DISPLAY_DEVICE_WAIT_MS} ms`, async () => {
      vi.useFakeTimers();
      try {
        const { deps, toApp } = withTunnel();
        const c = new DisplayCoordinator(deps);
        const pending = c.onDisplaySession(ACTIVE);
        await vi.advanceTimersByTimeAsync(DISPLAY_DEVICE_WAIT_MS - 1);
        expect(toApp.notifyDisplayStopRequest).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'no-device' });
        expect(deps.broadcast).not.toHaveBeenCalled();
        expect(c.getCurrentPayload()).toBeNull();
        expect(c.getActiveSessionId()).toBe('s1'); // main's end message clears it
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops with port-in-use when the reverse fails on an attached device, and the end path still cleans up', async () => {
      const { deps, toApp, attach } = withTunnel(async (l) => { if (l === 8788) throw new Error('cannot bind'); });
      attach();
      const c = new DisplayCoordinator(deps);
      await c.onDisplaySession(ACTIVE);
      expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'port-in-use' });
      expect(deps.broadcast).not.toHaveBeenCalled();
      expect(c.getCurrentPayload()).toBeNull();
      await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'port-in-use' });
      expect(deps.broadcast).toHaveBeenLastCalledWith({ state: 'error', sessionId: 's1', reason: 'port-in-use' });
      expect(c.getActiveSessionId()).toBeNull();
    });

    it('an end that arrives while waiting for the device never broadcasts ready or asks for a stop', async () => {
      const { deps, toApp, attach } = withTunnel();
      const c = new DisplayCoordinator(deps);
      const pending = c.onDisplaySession(ACTIVE);
      await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'phone-bye' });
      await pending;
      attach();
      expect(toApp.notifyDisplayStopRequest).not.toHaveBeenCalled();
      expect(deps.broadcast.mock.calls.map(([p]) => p.state)).toEqual(['ended']);
    });

    it('a token that arrives before any device attached (core restart) is delivered once the phone attaches', async () => {
      const { deps, toApp, attach } = withTunnel();
      const deliverToken = vi.fn(async () => {});
      const c = new DisplayCoordinator({ ...deps, deliverToken });
      const pending = c.onDisplayToken({ sessionId: 's1', token: 'tok123' });
      attach();
      await pending;
      expect(deliverToken).toHaveBeenCalledWith('phone1', 's1', 'tok123');
      expect(toApp.notifyDisplayStopRequest).not.toHaveBeenCalled();
    });

    it('drops a token whose session ended while waiting for the phone', async () => {
      const { deps, toApp, attach } = withTunnel();
      const deliverToken = vi.fn(async () => {});
      const c = new DisplayCoordinator({ ...deps, deliverToken });
      const pending = c.onDisplayToken({ sessionId: 's1', token: 'tok123' });
      await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'phone-bye' });
      attach();
      await pending;
      expect(deliverToken).not.toHaveBeenCalled();
      expect(toApp.notifyDisplayStopRequest).not.toHaveBeenCalled();
    });

    it("an end for another session does not drop a waiting token", async () => {
      const { deps, attach } = withTunnel();
      const deliverToken = vi.fn(async () => {});
      const c = new DisplayCoordinator({ ...deps, deliverToken });
      const pending = c.onDisplayToken({ sessionId: 's2', token: 'tok123' });
      await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'superseded' });
      attach();
      await pending;
      expect(deliverToken).toHaveBeenCalledWith('phone1', 's2', 'tok123');
    });

    it(`a token with no device for ${DISPLAY_DEVICE_WAIT_MS} ms ends with token-delivery-failed`, async () => {
      vi.useFakeTimers();
      try {
        const { deps, toApp } = withTunnel();
        const c = new DisplayCoordinator(deps);
        const pending = c.onDisplayToken({ sessionId: 's1', token: 'tok123' });
        await vi.advanceTimersByTimeAsync(DISPLAY_DEVICE_WAIT_MS);
        await pending;
        expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'token-delivery-failed' });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('re-broadcasts ready on a repeated displaySession', async () => {
    const { deps } = makeDeps();
    const c = new DisplayCoordinator(deps);
    await c.onDisplaySession(ACTIVE);
    await c.onDisplaySession(ACTIVE);
    expect(deps.broadcast).toHaveBeenCalledTimes(2);
    expect(deps.broadcast.mock.calls.every(([p]) => p.state === 'ready' && p.sessionId === 's1')).toBe(true);
    expect(deps.tunnel.addPort).toHaveBeenCalledWith(8788);
  });

  it('on session end clears suppression, removes the port, rechecks presence and broadcasts ended', async () => {
    const { deps, calls } = makeDeps();
    const c = new DisplayCoordinator(deps);
    await c.onDisplaySession(ACTIVE);
    calls.length = 0;
    await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'phone-bye' });
    expect(calls).toEqual(['suppress:false', 'removePort:8788', 'recheck', 'broadcast:ended']);
    expect(deps.broadcast).toHaveBeenLastCalledWith({ state: 'ended', sessionId: 's1', reason: 'phone-bye' });
    expect(c.getActiveSessionId()).toBeNull();
  });

  it('a session that never became active still broadcasts its error, without a presence recheck', async () => {
    const { deps } = makeDeps();
    await new DisplayCoordinator(deps).onDisplaySession({ active: false, sessionId: null, videoPort: null, reason: 'unsupported' });
    expect(deps.broadcast).toHaveBeenCalledWith({ state: 'error', sessionId: null, reason: 'unsupported' });
    expect(deps.recheckPresence).not.toHaveBeenCalled();
  });

  it('broadcasts error (not ended) for unsupported', async () => {
    const { deps } = makeDeps();
    const c = new DisplayCoordinator(deps);
    await c.onDisplaySession(ACTIVE);
    await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'unsupported' });
    expect(deps.broadcast).toHaveBeenLastCalledWith({ state: 'error', sessionId: 's1', reason: 'unsupported' });
  });

  it('classifies exactly the Task 2.5 error reasons as errors', () => {
    expect([...DISPLAY_ERROR_REASONS].sort()).toEqual([
      'capture-failed', 'capture-unavailable', 'helper-crashed', 'no-device', 'permission-screen-recording',
      'port-in-use', 'protocol-error', 'token-delivery-failed', 'unsupported', 'unsupported-host', 'version-mismatch',
    ]);
  });

  it('forwards phone stop as displayStopRequest with user-exit', () => {
    const { deps, toApp } = makeDeps();
    new DisplayCoordinator(deps).onPhoneStop({ sessionId: 's1' });
    expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'user-exit' });
  });

  it("forwards the phone's stop reason instead of user-exit", () => {
    const { deps, toApp } = makeDeps();
    new DisplayCoordinator(deps).onPhoneStop({ sessionId: 's1', reason: 'reply-timeout' });
    expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'reply-timeout' });
  });

  it('falls back to user-exit for a stop reason that is not a DisplayReason', () => {
    const { deps, toApp } = makeDeps();
    new DisplayCoordinator(deps).onPhoneStop({ sessionId: null, reason: 'from-the-future' });
    expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: null, reason: 'user-exit' });
  });

  it('an inactive displaySession without a reason clears silently', async () => {
    const { deps } = makeDeps();
    const c = new DisplayCoordinator(deps);
    await c.onDisplaySession(ACTIVE);
    deps.broadcast.mockClear();
    await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null });
    expect(deps.setSleepSuppressed).toHaveBeenLastCalledWith(false);
    expect(deps.tunnel.removePort).toHaveBeenCalledWith(8788);
    expect(deps.broadcast).not.toHaveBeenCalled();
    expect(c.getCurrentPayload()).toBeNull();
  });

  it('does not broadcast ready when the session ended while the tunnel was opening', async () => {
    let release!: () => void;
    const { deps } = makeDeps();
    deps.tunnel.addPort = vi.fn(() => new Promise<boolean>((r) => { release = () => r(true); }));
    const c = new DisplayCoordinator(deps);
    const pending = c.onDisplaySession(ACTIVE);
    await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'phone-bye' });
    release();
    await pending;
    expect(deps.broadcast.mock.calls.map(([p]) => p.state)).toEqual(['ended']);
    expect(c.getCurrentPayload()).toBeNull();
  });

  it('getCurrentPayload is the ready payload while active and null otherwise', async () => {
    const { deps } = makeDeps();
    const c = new DisplayCoordinator(deps);
    expect(c.getCurrentPayload()).toBeNull();
    expect(c.getActiveSessionId()).toBeNull();
    await c.onDisplaySession(ACTIVE);
    expect(c.getCurrentPayload()).toEqual({ state: 'ready', sessionId: 's1', videoPort: 8788 });
    expect(c.getActiveSessionId()).toBe('s1');
    await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'stop-requested' });
    expect(c.getCurrentPayload()).toBeNull();
  });

  describe('fix round 1', () => {
    const ACTIVE_S2 = { active: true, sessionId: 's2', videoPort: 8788 };

    it('a stale inactive displaySession for another session keeps the active one and still broadcasts its end', async () => {
      const { deps } = makeDeps();
      const c = new DisplayCoordinator(deps);
      await c.onDisplaySession(ACTIVE_S2);
      deps.setSleepSuppressed.mockClear();
      await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null, reason: 'superseded' });
      expect(deps.setSleepSuppressed).not.toHaveBeenCalled();
      expect(deps.tunnel.removePort).not.toHaveBeenCalled();
      expect(deps.recheckPresence).not.toHaveBeenCalled();
      expect(c.getCurrentPayload()).toEqual({ state: 'ready', sessionId: 's2', videoPort: 8788 });
      expect(c.getActiveSessionId()).toBe('s2');
      expect(deps.broadcast).toHaveBeenLastCalledWith({ state: 'ended', sessionId: 's1', reason: 'superseded' });
    });

    it('a null-sessionId inactive displaySession never clears an active session', async () => {
      const { deps } = makeDeps();
      const c = new DisplayCoordinator(deps);
      await c.onDisplaySession(ACTIVE_S2);
      deps.setSleepSuppressed.mockClear();
      await c.onDisplaySession({ active: false, sessionId: null, videoPort: null, reason: 'unsupported' });
      expect(deps.setSleepSuppressed).not.toHaveBeenCalled();
      expect(deps.tunnel.removePort).not.toHaveBeenCalled();
      expect(c.getCurrentPayload()).toEqual({ state: 'ready', sessionId: 's2', videoPort: 8788 });
      expect(deps.broadcast).toHaveBeenLastCalledWith({ state: 'error', sessionId: null, reason: 'unsupported' });
    });

    it('a stale inactive displaySession without a reason is fully ignored', async () => {
      const { deps } = makeDeps();
      const c = new DisplayCoordinator(deps);
      await c.onDisplaySession(ACTIVE_S2);
      deps.broadcast.mockClear();
      await c.onDisplaySession({ active: false, sessionId: 's1', videoPort: null });
      expect(deps.tunnel.removePort).not.toHaveBeenCalled();
      expect(deps.broadcast).not.toHaveBeenCalled();
      expect(c.getActiveSessionId()).toBe('s2');
    });

    it('drops the previous ready payload as soon as a new session becomes active', async () => {
      let release!: () => void;
      const { deps } = makeDeps();
      const c = new DisplayCoordinator(deps);
      await c.onDisplaySession(ACTIVE);
      deps.tunnel.addPort = vi.fn(() => new Promise<boolean>((r) => { release = () => r(true); }));
      const pending = c.onDisplaySession(ACTIVE_S2);
      expect(c.getCurrentPayload()).toBeNull();
      release();
      await pending;
      expect(c.getCurrentPayload()).toEqual({ state: 'ready', sessionId: 's2', videoPort: 8788 });
    });

    it('does not deliver the token when the phone changed since the start request', async () => {
      let serial: string | null = 'phone1';
      const { deps, toApp } = makeDeps({ getSerial: () => serial });
      const c = new DisplayCoordinator(deps);
      c.onPhoneStart(START);
      serial = 'phone2';
      await c.onDisplayToken({ sessionId: 's1', token: 'tok123' });
      expect(deps.deliverToken).not.toHaveBeenCalled();
      expect(toApp.notifyDisplayStopRequest).toHaveBeenCalledWith({ sessionId: 's1', reason: 'token-delivery-failed' });
      expect(JSON.stringify(deps.onLog.mock.calls)).not.toContain('tok123');
    });

    it('delivers the token to the phone the start request named', async () => {
      const { deps } = makeDeps();
      const c = new DisplayCoordinator(deps);
      c.onPhoneStart(START);
      await c.onDisplayToken({ sessionId: 's1', token: 'tok123' });
      expect(deps.deliverToken).toHaveBeenCalledWith('phone1', 's1', 'tok123');
    });
  });
});
