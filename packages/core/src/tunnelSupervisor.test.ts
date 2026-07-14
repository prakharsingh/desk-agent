import { describe, it, expect, vi } from 'vitest';
import { TunnelSupervisor } from './index.js';
import type { AdbRunner } from './index.js';

function makeFakeAdb(): AdbRunner & { emitAttach: () => void; emitDetach: () => void } {
  let handler: ((event: { type: 'attach' | 'detach'; serial: string }) => void) | undefined;
  return {
    reverse: vi.fn(async () => {}),
    launchApp: vi.fn(async () => {}),
    trackDevices: (onEvent) => { handler = onEvent; return { stop: vi.fn() }; },
    emitAttach: () => handler?.({ type: 'attach', serial: 'phone1' }),
    emitDetach: () => handler?.({ type: 'detach', serial: 'phone1' }),
  };
}

describe('TunnelSupervisor', () => {
  it('re-issues adb reverse on device attach', () => {
    const adb = makeFakeAdb();
    const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
    supervisor.start();
    adb.emitAttach();
    expect(adb.reverse).toHaveBeenCalledWith(8787, 8787);
  });

  it('re-issues adb reverse again after a simulated detach then re-attach', () => {
    const adb = makeFakeAdb();
    const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
    supervisor.start();
    adb.emitAttach();
    adb.emitDetach();
    adb.emitAttach();
    expect(adb.reverse).toHaveBeenCalledTimes(2);
  });

  it('logs and does not throw when adb reverse rejects', async () => {
    const onLog = vi.fn();
    const adb: AdbRunner = {
      reverse: vi.fn(async () => { throw new Error('adb not found'); }),
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
      expect(adb.reverse).toHaveBeenCalledWith(8787, 8787);
      expect(supervisor.getStatus().tunnelStatus).toBe('reissued');
    });

    it('reports failed (with a timestamp) when adb reverse rejects', async () => {
      const adb: AdbRunner = {
        reverse: vi.fn(async () => { throw new Error('adb not found'); }),
        launchApp: vi.fn(async () => {}),
        trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p' }); return { stop: vi.fn() }; },
      };
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      await vi.waitFor(() => expect(supervisor.getStatus().tunnelStatus).toBe('failed'));
      expect(supervisor.getStatus().lastReissueAt).toEqual(expect.any(Number));
    });
  });

  describe('launching the phone app on dock (backlog: auto-launch on USB dock)', () => {
    it('launches the app with the attached serial after re-issuing the tunnel', async () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      adb.emitAttach();
      await vi.waitFor(() => expect(adb.launchApp).toHaveBeenCalledWith('phone1'));
      expect(adb.reverse).toHaveBeenCalledWith(8787, 8787);
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
});
