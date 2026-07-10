import { describe, it, expect, vi } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import energySaverPlugin from './index.js';

describe('energySaverPlugin', () => {
  it('declares sys:control-display and no widgets', async () => {
    expect(energySaverPlugin.permissions).toEqual(['sys:control-display']);
    expect(await energySaverPlugin.getWidgets()).toEqual([]);
  });

  it('runs pmset displaysleepnow on the sleep-display action', async () => {
    const host = createFakeHost(energySaverPlugin, { grantedPermissions: ['sys:control-display'] });
    const run = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    (host.ctx.exec.run as any) = run;
    await host.init();
    await host.onAction('sleep-display');
    expect(run).toHaveBeenCalledWith('pmset', ['displaysleepnow']);
  });

  it('logs and does not throw when pmset fails', async () => {
    const host = createFakeHost(energySaverPlugin, { grantedPermissions: ['sys:control-display'] });
    (host.ctx.exec.run as any) = vi.fn(async () => ({ stdout: '', stderr: 'not permitted', code: 1 }));
    await host.init();
    await expect(host.onAction('sleep-display')).resolves.not.toThrow();
    expect(host.recorder.logs).toContainEqual(expect.objectContaining({ level: 'error' }));
  });
});
