import { describe, it, expect, vi } from 'vitest';
import { TunnelSupervisor } from './index.js';
import type { AdbRunner } from './index.js';

function makeFakeAdb(): AdbRunner & { emitAttach: () => void; emitDetach: () => void; emitUnauthorized: () => void } {
  let handler: ((event: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void) | undefined;
  return {
    reverse: vi.fn(async () => {}),
    removeReverse: vi.fn(async () => {}),
    deliverDisplayToken: vi.fn(async () => {}),
    launchApp: vi.fn(async () => {}),
    trackDevices: (onEvent) => { handler = onEvent; return { stop: vi.fn() }; },
    emitAttach: () => handler?.({ type: 'attach', serial: 'phone1' }),
    emitDetach: () => handler?.({ type: 'detach', serial: 'phone1' }),
    emitUnauthorized: () => handler?.({ type: 'unauthorized', serial: 'phone1' }),
  };
}

describe('TunnelSupervisor', () => {
  it('re-issues adb reverse on device attach', () => {
    const adb = makeFakeAdb();
    const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
    supervisor.start();
    adb.emitAttach();
    expect(adb.reverse).toHaveBeenCalledWith(8787, 8787, 'phone1');
  });

  it('re-issues adb reverse again after a simulated detach then re-attach', async () => {
    const adb = makeFakeAdb();
    const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
    supervisor.start();
    adb.emitAttach();
    adb.emitDetach();
    adb.emitAttach();
    // The second reverse is queued behind the first (per-port ordering), so it lands a tick later.
    await vi.waitFor(() => expect(adb.reverse).toHaveBeenCalledTimes(2));
  });

  it('logs and does not throw when adb reverse rejects', async () => {
    const onLog = vi.fn();
    const adb: AdbRunner = {
      reverse: vi.fn(async () => { throw new Error('adb not found'); }),
      removeReverse: vi.fn(async () => {}),
      deliverDisplayToken: vi.fn(async () => {}),
      launchApp: vi.fn(async () => {}),
      trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p' }); return { stop: vi.fn() }; },
    };
    expect(() => new TunnelSupervisor(adb, 8787, onLog).start()).not.toThrow();
    await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('adb not found')));
  });

  describe('getStatus (Phase 3 state-surface: Device pane)', () => {
    it('starts idle with no serial and no reissue timestamp', () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      expect(supervisor.getStatus()).toEqual({
        serial: null,
        model: null,
        unauthorizedSerial: null,
        tunnelStatus: 'idle',
        lastReissueAt: null,
        launchAppOnDock: true,
        appLaunchStatus: 'idle',
        lastAppLaunchAt: null,
      });
    });

    it('records the serial on attach and reports reissued + a timestamp after a successful reverse', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(supervisor.getStatus().tunnelStatus).toBe('reissued'));
      const status = supervisor.getStatus();
      expect(status.serial).toBe('phone1');
      expect(status.lastReissueAt).toEqual(expect.any(Number));
    });

    it('clears the serial on detach', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(supervisor.getStatus().serial).toBe('phone1'));
      adb.emitDetach();
      expect(supervisor.getStatus().serial).toBeNull();
    });

    it('reissue() is public so a manual "Re-issue" action can trigger it directly, without waiting for an attach event', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      await supervisor.reissue();
      expect(adb.reverse).toHaveBeenCalledWith(8787, 8787, null);
      expect(supervisor.getStatus().tunnelStatus).toBe('reissued');
    });

    it('reports failed (with a timestamp) when adb reverse rejects', async () => {
      const adb: AdbRunner = {
        reverse: vi.fn(async () => { throw new Error('adb not found'); }),
        removeReverse: vi.fn(async () => {}),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p' }); return { stop: vi.fn() }; },
      };
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      await vi.waitFor(() => expect(supervisor.getStatus().tunnelStatus).toBe('failed'));
      expect(supervisor.getStatus().lastReissueAt).toEqual(expect.any(Number));
    });
  });

  describe('unauthorized device', () => {
    it('records the unauthorized serial without issuing reverse, and clears it on attach', () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      adb.emitUnauthorized();
      expect(supervisor.getStatus().unauthorizedSerial).toBe('phone1');
      expect(adb.reverse).not.toHaveBeenCalled();
      adb.emitAttach();
      expect(supervisor.getStatus().unauthorizedSerial).toBeNull();
    });

    it('clears it on the detach the runner emits when that serial vanishes', () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      adb.emitUnauthorized();
      adb.emitDetach();
      expect(supervisor.getStatus().unauthorizedSerial).toBeNull();
    });

    it('an unauthorized phone B vanishing does not disturb attached phone A', async () => {
      let handler!: (e: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void;
      const adb: AdbRunner = {
        reverse: vi.fn(async () => {}),
        removeReverse: vi.fn(async () => {}),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        trackDevices: (onEvent) => { handler = onEvent; return { stop: vi.fn() }; },
      };
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      handler({ type: 'attach', serial: 'A' });
      await vi.waitFor(() => expect(supervisor.getStatus().tunnelStatus).toBe('reissued'));
      handler({ type: 'unauthorized', serial: 'B' });
      expect(supervisor.getStatus().unauthorizedSerial).toBe('B');
      handler({ type: 'detach', serial: 'B' });
      const st = supervisor.getStatus();
      expect(st.unauthorizedSerial).toBeNull();
      expect(st.serial).toBe('A');
      expect(st.tunnelStatus).toBe('reissued');
    });
  });

  describe('multiple ports (extended display video port)', () => {
    it('re-issues every registered port with the attached serial', async () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn());
      sup.start();
      await sup.addPort(8788);
      adb.emitAttach();
      await vi.waitFor(() => {
        expect(adb.reverse).toHaveBeenCalledWith(8787, 8787, 'phone1');
        expect(adb.reverse).toHaveBeenCalledWith(8788, 8788, 'phone1');
      });
    });

    it('reverses a newly added port immediately when a device is attached', async () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn());
      sup.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'));
      await sup.addPort(8788);
      expect(adb.reverse).toHaveBeenCalledWith(8788, 8788, 'phone1');
      expect(sup.getPorts()).toEqual([8787, 8788]);
    });

    it('does not reverse an added port when no device is attached, but registers it', async () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn());
      await sup.addPort(8788);
      expect(adb.reverse).not.toHaveBeenCalled();
      expect(sup.getPorts()).toEqual([8787, 8788]);
    });

    it('stops re-issuing a removed port', async () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn());
      await sup.addPort(8788);
      sup.removePort(8788);
      sup.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(adb.reverse).toHaveBeenCalledWith(8787, 8787, 'phone1'));
      expect(adb.reverse).not.toHaveBeenCalledWith(8788, 8788, expect.anything());
    });

    it('never removes the JSON port', () => {
      const sup = new TunnelSupervisor(makeFakeAdb(), 8787, vi.fn());
      sup.removePort(8787);
      expect(sup.getPorts()).toContain(8787);
    });

    it('addPort resolves true once the reverse is up, false when it failed or no device is attached', async () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn(), false);
      await expect(sup.addPort(8788)).resolves.toBe(false); // no device: registered, not reversed
      sup.removePort(8788);
      sup.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'));
      await expect(sup.addPort(8788)).resolves.toBe(true);
      await expect(sup.addPort(8788)).resolves.toBe(true); // already registered and up
      sup.removePort(8788);
      (adb.reverse as ReturnType<typeof vi.fn>).mockImplementation(async () => { throw new Error('port busy'); });
      await expect(sup.addPort(8788)).resolves.toBe(false);
      await expect(sup.addPort(8788)).resolves.toBe(false); // already registered but failed
    });

    it('removePort tears down the reverse on the attached device', async () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn(), false);
      sup.start();
      adb.emitAttach();
      await sup.addPort(8788);
      sup.removePort(8788);
      expect(adb.removeReverse).toHaveBeenCalledWith(8788, 'phone1');
    });

    it('removePort issues no adb remove without an attached device, and never for the JSON port', async () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn(), false);
      await sup.addPort(8788);
      sup.removePort(8788);
      sup.start();
      adb.emitAttach();
      sup.removePort(8787);
      sup.removePort(9999); // never registered
      expect(adb.removeReverse).not.toHaveBeenCalled();
    });

    it('a rejecting removeReverse is logged, never thrown', async () => {
      const adb = makeFakeAdb();
      (adb.removeReverse as ReturnType<typeof vi.fn>).mockImplementation(async () => { throw new Error('remove boom'); });
      const onLog = vi.fn();
      const sup = new TunnelSupervisor(adb, 8787, onLog, false);
      sup.start();
      adb.emitAttach();
      await sup.addPort(8788);
      expect(() => sup.removePort(8788)).not.toThrow();
      await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith('warn', expect.stringContaining('remove boom')));
    });

    it('reports failed when any port fails, and never rejects from addPort', async () => {
      const adb = makeFakeAdb();
      (adb.reverse as ReturnType<typeof vi.fn>).mockImplementation(async (l: number) => {
        if (l === 8788) throw new Error('video reverse boom');
      });
      const onLog = vi.fn();
      const sup = new TunnelSupervisor(adb, 8787, onLog);
      sup.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'));
      await expect(sup.addPort(8788)).resolves.toBe(false);
      expect(sup.getStatus().tunnelStatus).toBe('failed');
      expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('video reverse boom'));
      await sup.reissue();
      expect(sup.getStatus().tunnelStatus).toBe('failed');
    });

    it('getSerial returns the attached serial or null', () => {
      const adb = makeFakeAdb();
      const sup = new TunnelSupervisor(adb, 8787, vi.fn());
      sup.start();
      expect(sup.getSerial()).toBeNull();
      adb.emitAttach();
      expect(sup.getSerial()).toBe('phone1');
      adb.emitDetach();
      expect(sup.getSerial()).toBeNull();
    });
  });

  describe('interleavings (in-flight reverse)', () => {
    type Handler = (e: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void;
    function deferredAdb() {
      let handler!: Handler;
      const pending: Array<{ l: number; serial: string | null; resolve: () => void; reject: (e: Error) => void }> = [];
      let hold: (l: number) => boolean = () => false;
      const calls: Array<[number, string | null]> = [];
      const adb: AdbRunner = {
        reverse: vi.fn((l: number, _r: number, serial: string | null) => {
          calls.push([l, serial]);
          if (!hold(l)) return Promise.resolve();
          return new Promise<void>((resolve, reject) => { pending.push({ l, serial, resolve, reject }); });
        }),
        removeReverse: vi.fn(async () => {}),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        trackDevices: (onEvent) => { handler = onEvent; return { stop: vi.fn() }; },
      };
      return { adb, pending, calls, emit: (type: 'attach' | 'detach', serial: string) => handler({ type, serial }), setHold: (h: (l: number) => boolean) => { hold = h; } };
    }
    const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    it('addPort during an in-flight reissue is reversed and not lost', async () => {
      const d = deferredAdb();
      d.setHold((l) => l === 8787);
      const sup = new TunnelSupervisor(d.adb, 8787, vi.fn(), false);
      sup.start();
      d.emit('attach', 'phone1');
      await tick();
      const added = sup.addPort(8788);
      d.pending[0].resolve();
      await added;
      await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'));
      expect(d.calls.filter(([l]) => l === 8788).length).toBeGreaterThanOrEqual(1);
      expect(d.calls).toContainEqual([8788, 'phone1']);
    });

    it('removePort during an in-flight failing reverse does not leave status stuck failed', async () => {
      const d = deferredAdb();
      const sup = new TunnelSupervisor(d.adb, 8787, vi.fn(), false);
      sup.start();
      d.emit('attach', 'phone1');
      await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'));
      d.setHold((l) => l === 8788);
      const added = sup.addPort(8788);
      await tick();
      sup.removePort(8788);
      d.pending[0].reject(new Error('late failure'));
      await added;
      expect(sup.getStatus().tunnelStatus).toBe('reissued');
    });

    it('removePort during an in-flight successful reverse removes it once it lands (no orphaned reverse)', async () => {
      const d = deferredAdb();
      const sup = new TunnelSupervisor(d.adb, 8787, vi.fn(), false);
      sup.start();
      d.emit('attach', 'phone1');
      await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'));
      d.setHold((l) => l === 8788);
      const added = sup.addPort(8788);
      await tick();
      sup.removePort(8788);
      d.pending[0].resolve();
      await expect(added).resolves.toBe(false);
      expect(d.adb.removeReverse).toHaveBeenLastCalledWith(8788, 'phone1');
      expect(vi.mocked(d.adb.removeReverse).mock.invocationCallOrder.at(-1)!)
        .toBeGreaterThan(vi.mocked(d.adb.reverse).mock.invocationCallOrder.at(-1)!);
    });

    it('a serial change mid-pass stops the old pass; the new attach pass reverses all ports with the new serial', async () => {
      const d = deferredAdb();
      d.setHold((l) => l === 8787);
      const sup = new TunnelSupervisor(d.adb, 8787, vi.fn(), false);
      await sup.addPort(8788);
      sup.start();
      d.emit('attach', 'phone1');
      await tick();
      d.emit('detach', 'phone1');
      d.setHold(() => false);
      d.emit('attach', 'phone2');
      d.pending[0].resolve();
      await vi.waitFor(() => {
        expect(d.calls).toContainEqual([8787, 'phone2']);
        expect(d.calls).toContainEqual([8788, 'phone2']);
      });
      expect(d.calls).not.toContainEqual([8788, 'phone1']);
    });

    it('recovers from failed to reissued after a later successful reissue', async () => {
      const d = deferredAdb();
      const sup = new TunnelSupervisor(d.adb, 8787, vi.fn(), false);
      sup.start();
      d.emit('attach', 'phone1');
      await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'));
      (d.adb.reverse as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new Error('flaky'); });
      await sup.reissue();
      expect(sup.getStatus().tunnelStatus).toBe('failed');
      await sup.reissue();
      expect(sup.getStatus().tunnelStatus).toBe('reissued');
    });
  });

  describe('port readiness (waitForPort / waitForSerial) and per-port adb ordering', () => {
    type Handler = (e: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void;
    type Op = { kind: 'reverse' | 'remove'; port: number; serial: string | null; resolve: () => void; reject: (e: Error) => void };
    // Every reverse/remove is held until the test settles it, so ordering is observable.
    function heldAdb() {
      let handler!: Handler;
      const ops: Op[] = [];
      let autoResolve = (_o: Omit<Op, 'resolve' | 'reject'>) => false;
      const record = (kind: Op['kind'], port: number, serial: string | null) => new Promise<void>((resolve, reject) => {
        if (autoResolve({ kind, port, serial })) { ops.push({ kind, port, serial, resolve: () => {}, reject: () => {} }); resolve(); return; }
        ops.push({ kind, port, serial, resolve, reject });
      });
      const adb: AdbRunner = {
        reverse: vi.fn((l: number, _r: number, serial: string | null) => record('reverse', l, serial)),
        removeReverse: vi.fn((port: number, serial: string | null) => record('remove', port, serial)),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        trackDevices: (onEvent) => { handler = onEvent; return { stop: vi.fn() }; },
      };
      return {
        adb, ops,
        emit: (type: 'attach' | 'detach', serial: string) => handler({ type, serial }),
        setAuto: (f: (o: Omit<Op, 'resolve' | 'reject'>) => boolean) => { autoResolve = f; },
        seq: () => ops.map((o) => `${o.kind}:${o.port}`),
      };
    }
    const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

    it('waitForPort resolves up only once the reverse has landed on a device that attached later', async () => {
      const h = heldAdb();
      h.setAuto((o) => o.port === 8787);
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      sup.start();
      await expect(sup.addPort(8788)).resolves.toBe(false); // no device yet: registered only
      let outcome: string | undefined;
      void sup.waitForPort(8788, 10_000).then((o) => { outcome = o; });
      h.emit('attach', 'phone1');
      await tick();
      expect(outcome).toBeUndefined(); // reverse issued but not landed: registration is not readiness
      h.ops.find((o) => o.port === 8788)!.resolve();
      await tick();
      expect(outcome).toBe('up');
      await expect(sup.waitForPort(8788, 10_000)).resolves.toBe('up');
    });

    it('waitForPort resolves no-device when nothing attaches within the timeout', async () => {
      vi.useFakeTimers();
      try {
        const h = heldAdb();
        const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
        sup.start();
        await sup.addPort(8788);
        let outcome: string | undefined;
        void sup.waitForPort(8788, 10_000).then((o) => { outcome = o; });
        await vi.advanceTimersByTimeAsync(9_999);
        expect(outcome).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toBe('no-device');
      } finally {
        vi.useRealTimers();
      }
    });

    it('waitForPort keeps waiting past the deadline while a device is attached and the reverse is in flight', async () => {
      vi.useFakeTimers();
      try {
        const h = heldAdb();
        h.setAuto((o) => o.port === 8787);
        const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
        sup.start();
        h.emit('attach', 'phone1');
        await vi.advanceTimersByTimeAsync(0);
        const added = sup.addPort(8788);
        let outcome: string | undefined;
        void sup.waitForPort(8788, 10_000).then((o) => { outcome = o; });
        await vi.advanceTimersByTimeAsync(25_000);
        expect(outcome).toBeUndefined();
        h.ops.find((o) => o.port === 8788)!.resolve();
        await added;
        await vi.advanceTimersByTimeAsync(0);
        expect(outcome).toBe('up');
      } finally {
        vi.useRealTimers();
      }
    });

    it('waitForPort resolves failed when the reverse fails on an attached device', async () => {
      const h = heldAdb();
      h.setAuto((o) => o.port === 8787);
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      sup.start();
      h.emit('attach', 'phone1');
      await tick();
      const added = sup.addPort(8788);
      const outcome = sup.waitForPort(8788, 10_000);
      await tick();
      h.ops.find((o) => o.port === 8788)!.reject(new Error('cannot bind'));
      await added;
      await expect(outcome).resolves.toBe('failed');
    });

    it('a stale device\'s late reverse failure does not fail the port for the device that replaced it', async () => {
      const h = heldAdb();
      h.setAuto((o) => o.port === 8787);
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      sup.start();
      h.emit('attach', 'phone1');
      await tick();
      void sup.addPort(8788); // phone1's reverse hangs
      await tick();
      h.emit('detach', 'phone1');
      h.emit('attach', 'phone2'); // phone2's reverse queues behind phone1's
      await tick();
      h.ops.find((o) => o.port === 8788 && o.serial === 'phone1')!.reject(new Error('timed out'));
      await tick();
      let outcome: string | undefined;
      void sup.waitForPort(8788, 10_000).then((o) => { outcome = o; });
      await tick();
      expect(outcome).toBeUndefined();
      h.ops.find((o) => o.port === 8788 && o.serial === 'phone2')!.resolve();
      await tick();
      expect(outcome).toBe('up');
    });

    it('waitForPort resolves removed when the port is removed while waiting', async () => {
      const h = heldAdb();
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      await sup.addPort(8788);
      const outcome = sup.waitForPort(8788, 10_000);
      sup.removePort(8788);
      await expect(outcome).resolves.toBe('removed');
    });

    it('a detach clears readiness (the reverse died with the device)', async () => {
      const h = heldAdb();
      h.setAuto(() => true);
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      sup.start();
      h.emit('attach', 'phone1');
      await tick();
      await expect(sup.addPort(8788)).resolves.toBe(true);
      h.emit('detach', 'phone1');
      let outcome: string | undefined;
      void sup.waitForPort(8788, 10_000).then((o) => { outcome = o; });
      await tick();
      expect(outcome).toBeUndefined();
      h.emit('attach', 'phone1');
      await tick();
      expect(outcome).toBe('up');
    });

    it('a failure on a previous device never makes a fresh waitForPort report failed while the new reverse is in flight', async () => {
      const h = heldAdb();
      h.setAuto((o) => o.port === 8787);
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      sup.start();
      h.emit('attach', 'phone1');
      await tick();
      const a = sup.addPort(8788);
      await tick();
      h.ops.find((o) => o.port === 8788)!.reject(new Error('cannot bind'));
      await a;
      await expect(sup.waitForPort(8788, 10_000)).resolves.toBe('failed');
      h.emit('detach', 'phone1');
      h.emit('attach', 'phone2');
      await tick();
      let outcome: string | undefined;
      void sup.waitForPort(8788, 10_000).then((o) => { outcome = o; });
      await tick();
      expect(outcome).toBeUndefined(); // phone2's reverse is still in flight
      h.ops.filter((o) => o.port === 8788 && o.serial === 'phone2')[0]!.resolve();
      await tick();
      expect(outcome).toBe('up');
    });

    it('waitForSerial resolves on attach, or null at the timeout', async () => {
      vi.useFakeTimers();
      try {
        const h = heldAdb();
        h.setAuto(() => true);
        const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
        sup.start();
        const late = sup.waitForSerial(10_000);
        h.emit('attach', 'phone1');
        await expect(late).resolves.toBe('phone1');
        await expect(sup.waitForSerial(10_000)).resolves.toBe('phone1');
        h.emit('detach', 'phone1');
        const none = sup.waitForSerial(10_000);
        await vi.advanceTimersByTimeAsync(10_000);
        await expect(none).resolves.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('serializes adb operations per port: a re-add waits for the pending remove', async () => {
      const h = heldAdb();
      h.setAuto((o) => o.port === 8787);
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      sup.start();
      h.emit('attach', 'phone1');
      await tick();
      const a = sup.addPort(8788);
      await tick();
      h.ops.find((o) => o.kind === 'reverse' && o.port === 8788)!.resolve();
      await a;
      sup.removePort(8788); // session A ends: remove held in flight
      const b = sup.addPort(8788); // session B starts
      await tick();
      expect(h.seq().filter((s) => s.endsWith(':8788'))).toEqual(['reverse:8788', 'remove:8788']);
      h.ops.find((o) => o.kind === 'remove')!.resolve();
      await tick();
      expect(h.seq().filter((s) => s.endsWith(':8788'))).toEqual(['reverse:8788', 'remove:8788', 'reverse:8788']);
      h.ops.filter((o) => o.kind === 'reverse' && o.port === 8788)[1]!.resolve();
      await expect(b).resolves.toBe(true);
    });

    it("a stale removal from session A never tears down session B's reverse", async () => {
      const h = heldAdb();
      h.setAuto((o) => o.port === 8787);
      const sup = new TunnelSupervisor(h.adb, 8787, vi.fn(), false);
      sup.start();
      h.emit('attach', 'phone1');
      await tick();
      const a = sup.addPort(8788); // A's reverse in flight
      await tick();
      sup.removePort(8788); // A ends while its reverse is in flight
      const b = sup.addPort(8788); // B starts
      await tick();
      h.ops.filter((o) => o.port === 8788)[0]!.resolve(); // A's reverse lands
      await tick();
      h.ops.filter((o) => o.port === 8788)[1]!.resolve(); // A's remove
      await tick();
      h.ops.filter((o) => o.port === 8788)[2]?.resolve(); // B's reverse
      await Promise.all([a, b]);
      await tick();
      // reverse(A), remove(A), reverse(B) -- and nothing after B's reverse.
      expect(h.seq().filter((s) => s.endsWith(':8788'))).toEqual(['reverse:8788', 'remove:8788', 'reverse:8788']);
      await expect(sup.waitForPort(8788, 10_000)).resolves.toBe('up');
    });
  });

  describe('launching the phone app on dock (backlog: auto-launch on USB dock)', () => {
    it('launches the app with the attached serial after re-issuing the tunnel', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(adb.launchApp).toHaveBeenCalledWith('phone1'));
      expect(adb.reverse).toHaveBeenCalledWith(8787, 8787, 'phone1');
    });

    it('does not launch the app on attach when launchAppOnDock has been disabled', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.setLaunchAppOnDock(false);
      supervisor.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(adb.reverse).toHaveBeenCalled());
      expect(adb.launchApp).not.toHaveBeenCalled();
    });

    it('setLaunchAppOnDock is reflected in getStatus()', () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.setLaunchAppOnDock(false);
      expect(supervisor.getStatus().launchAppOnDock).toBe(false);
    });

    it('a manual launchApp() call launches regardless of the launchAppOnDock toggle', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.setLaunchAppOnDock(false);
      await supervisor.launchApp();
      expect(adb.launchApp).toHaveBeenCalledTimes(1);
      expect(supervisor.getStatus().appLaunchStatus).toBe('launched');
    });

    it('reports appLaunchStatus failed (with a timestamp), non-fatally, when launchApp rejects', async () => {
      const onLog = vi.fn();
      const adb: AdbRunner = {
        reverse: vi.fn(async () => {}),
        removeReverse: vi.fn(async () => {}),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => { throw new Error('app not installed'); }),
        trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p' }); return { stop: vi.fn() }; },
      };
      const supervisor = new TunnelSupervisor(adb, 8787, onLog);
      expect(() => supervisor.start()).not.toThrow();
      await vi.waitFor(() => expect(supervisor.getStatus().appLaunchStatus).toBe('failed'));
      expect(supervisor.getStatus().lastAppLaunchAt).toEqual(expect.any(Number));
      expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('app not installed'));
      // Non-fatal to the tunnel itself: reverse still succeeded independently.
      expect(supervisor.getStatus().tunnelStatus).toBe('reissued');
    });

    it('does not launch the app until reissue() has actually resolved, not just been fired', async () => {
      let resolveReverse!: () => void;
      const reversePromise = new Promise<void>((resolve) => { resolveReverse = resolve; });
      const adb: AdbRunner = {
        reverse: vi.fn(async () => { await reversePromise; }),
        removeReverse: vi.fn(async () => {}),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p' }); return { stop: vi.fn() }; },
      };
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(adb.launchApp).not.toHaveBeenCalled();
      resolveReverse();
      await vi.waitFor(() => expect(adb.launchApp).toHaveBeenCalled());
    });

    it('a constructor-supplied default of false is honored on the very first attach', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn(), false);
      supervisor.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(adb.reverse).toHaveBeenCalled());
      expect(adb.launchApp).not.toHaveBeenCalled();
      expect(supervisor.getStatus().launchAppOnDock).toBe(false);
    });
  });
  describe('device model name (Device pane card title)', () => {
    function fakeAdbWithModel(getModel: AdbRunner['getModel']) {
      let handler: ((event: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void) | undefined;
      const adb: AdbRunner = {
        reverse: vi.fn(async () => {}),
        removeReverse: vi.fn(async () => {}),
        deliverDisplayToken: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        getModel,
        trackDevices: (onEvent) => { handler = onEvent; return { stop: vi.fn() }; },
      };
      return { adb, emit: (type: 'attach' | 'detach', serial: string) => handler?.({ type, serial }) };
    }

    it('queries the model once on attach, scoped to the attached serial, and exposes it in getStatus()', async () => {
      const getModel = vi.fn(async () => 'OnePlus 6T');
      const { adb, emit } = fakeAdbWithModel(getModel);
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      expect(supervisor.getStatus().model).toBeNull();
      emit('attach', 'phone1');
      await vi.waitFor(() => expect(supervisor.getStatus().model).toBe('OnePlus 6T'));
      expect(getModel).toHaveBeenCalledTimes(1);
      expect(getModel).toHaveBeenCalledWith('phone1');
    });

    it('clears the model on detach', async () => {
      const { adb, emit } = fakeAdbWithModel(vi.fn(async () => 'OnePlus 6T'));
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      emit('attach', 'phone1');
      await vi.waitFor(() => expect(supervisor.getStatus().model).toBe('OnePlus 6T'));
      emit('detach', 'phone1');
      expect(supervisor.getStatus().model).toBeNull();
    });

    it('ignores a late model result for a device that has since detached', async () => {
      let resolveModel!: (m: string | null) => void;
      const { adb, emit } = fakeAdbWithModel(vi.fn(() => new Promise<string | null>((r) => { resolveModel = r; })));
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      emit('attach', 'phone1');
      emit('detach', 'phone1');
      resolveModel('OnePlus 6T');
      await Promise.resolve();
      await Promise.resolve();
      expect(supervisor.getStatus().model).toBeNull();
    });

    it('a failed model query is non-fatal: logs a warning, model stays null, tunnel still re-issued', async () => {
      const onLog = vi.fn();
      const { adb, emit } = fakeAdbWithModel(vi.fn(async () => { throw new Error('getprop exploded'); }));
      const supervisor = new TunnelSupervisor(adb, 8787, onLog);
      supervisor.start();
      emit('attach', 'phone1');
      await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith('warn', expect.stringContaining('getprop exploded')));
      expect(supervisor.getStatus().model).toBeNull();
      await vi.waitFor(() => expect(supervisor.getStatus().tunnelStatus).toBe('reissued'));
    });

    it('model stays null when the runner has no getModel (fakes / older runners)', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(supervisor.getStatus().tunnelStatus).toBe('reissued'));
      expect(supervisor.getStatus().model).toBeNull();
    });
  });
});
