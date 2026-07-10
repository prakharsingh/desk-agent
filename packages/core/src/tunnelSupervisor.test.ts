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
});
