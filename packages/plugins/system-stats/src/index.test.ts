import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import systemStatsPlugin from './index.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('systemStatsPlugin', () => {
  it('declares sys:read-stats and pushes a widget on the poll interval', async () => {
    expect(systemStatsPlugin.permissions).toEqual(['sys:read-stats']);
    const host = createFakeHost(systemStatsPlugin);
    await host.init();
    vi.advanceTimersByTime(2000);
    expect(host.recorder.publishedWidgets.length).toBeGreaterThan(0);
    expect(host.recorder.publishedWidgets[0].widgetId).toBe('system-stats');
    expect(host.recorder.publishedWidgets[0].widget.type).toBe('system-stats');
  });

  it('renders battery as "N/A" when exec reports no battery present', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'pmset' ) return { stdout: '', stderr: 'no battery', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.battery).toBe('N/A');
  });

  it('renders now-playing as "unavailable" when the osascript call is TCC-denied', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'osascript') return { stdout: '', stderr: 'not authorized', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('unavailable');
  });

  it('never throws out of init even if exec.run rejects', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async () => { throw new Error('spawn failed'); });
    await expect(systemStatsPlugin.init(host.ctx)).resolves.not.toThrow();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
