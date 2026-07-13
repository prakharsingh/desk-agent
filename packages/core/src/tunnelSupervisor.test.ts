import { describe, it, expect, vi } from 'vitest';
import { TunnelSupervisor } from './index.js';
import type { AdbRunner } from './index.js';

function makeFakeAdb(): AdbRunner & { emitAttach: () => void; emitDetach: () => void } {
  let handler: ((event: { type: 'attach' | 'detach'; serial: string }) => void) | undefined;
  return {
    reverse: vi.fn(async () => {}),
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
      trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p' }); return { stop: vi.fn() }; },
    };
    expect(() => new TunnelSupervisor(adb, 8787, onLog).start()).not.toThrow();
    await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('adb not found')));
  });

  describe('getStatus (Phase 3 state-surface: Device pane)', () => {
    it('starts idle with no serial and no reissue timestamp', () => {
      const adb = makeFakeAdb();
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      expect(supervisor.getStatus()).toEqual({ serial: null, tunnelStatus: 'idle', lastReissueAt: null });
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
        trackDevices: (onEvent) => { onEvent({ type: 'attach', serial: 'p' }); return { stop: vi.fn() }; },
      };
      const supervisor = new TunnelSupervisor(adb, 8787, vi.fn());
      supervisor.start();
      await vi.waitFor(() => expect(supervisor.getStatus().tunnelStatus).toBe('failed'));
      expect(supervisor.getStatus().lastReissueAt).toEqual(expect.any(Number));
    });
  });
});
