import { describe, it, expect, vi } from 'vitest';
import { createRealAdbRunner } from './adbRunner.js';

describe('createRealAdbRunner', () => {
  it('logs an error and does not crash when the adb binary is missing', async () => {
    const onLog = vi.fn();
    const runner = createRealAdbRunner(onLog, '/nonexistent/definitely-not-adb');
    const tracker = runner.trackDevices(() => {});
    await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('adb')));
    expect(() => tracker.stop()).not.toThrow();
  });
});
