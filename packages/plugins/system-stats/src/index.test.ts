import os, { type CpuInfo } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import systemStatsPlugin from './index.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('systemStatsPlugin', () => {
  it('computes cpuPercent from the delta between successive polls, not a cumulative since-boot average', async () => {
    // os.cpus()[i].times are cumulative counters since boot. A single snapshot's
    // idle/total ratio is the AVERAGE utilization since boot, which barely moves
    // between two polls seconds apart -- it must be diffed against the previous
    // snapshot to reflect the load during that interval.
    const snapshots: CpuInfo['times'][][] = [
      [{ user: 100_000, nice: 0, sys: 50_000, idle: 850_000, irq: 0 }], // poll #1 baseline
      [{ user: 100_150, nice: 0, sys: 50_000, idle: 850_150, irq: 0 }], // poll #2: +150 busy, +150 idle over the interval -> 50% busy
    ];
    let call = 0;
    vi.spyOn(os, 'cpus').mockImplementation(
      () => snapshots[Math.min(call++, snapshots.length - 1)].map((times) => ({ model: 'x', speed: 0, times })) as any,
    );
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async () => ({ stdout: '', stderr: '', code: 1 }));
    await systemStatsPlugin.init(host.ctx); // poll #1: establishes baseline, no prior snapshot to diff against
    await vi.advanceTimersByTimeAsync(2000); // poll #2: should diff against poll #1's snapshot
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.cpuPercent).toBe(50);
  });

  it('getWidgets reflects the last poll\'s real nowPlaying/battery instead of a stale hardcoded placeholder', async () => {
    // getWidgets() answers the hello snapshot on every connect/reconnect --
    // if it always returned a hardcoded "unavailable"/"N/A" placeholder
    // regardless of what poll() already observed, every reconnect would
    // briefly show wrong data even when the plugin has been running with
    // known-good state for a while.
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string, args?: string[]) => {
      if (command === 'pgrep') return { stdout: '123', stderr: '', code: 0 };
      if (command === 'pmset') return { stdout: 'Battery Power\n -InternalBattery-0 (id=1) 77%; discharging;', stderr: '', code: 0 };
      if (command === 'nowplaying-cli' && args?.[0] === 'get') {
        return { stdout: JSON.stringify({ title: 'Reconnect Track', playbackRate: 1 }), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    const widgets = await systemStatsPlugin.getWidgets();
    expect(widgets[0].props.nowPlaying).toBe('Reconnect Track');
    expect(widgets[0].props.nowPlayingIsPlaying).toBe(true);
    expect(widgets[0].props.battery).toBe('77%');
  });

  it('declares sys:read-stats and sys:control-media, and pushes a widget on the poll interval', async () => {
    expect(systemStatsPlugin.permissions).toEqual(['sys:read-stats', 'sys:control-media']);
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

  it('never calls nowplaying-cli when no known player process is running, reporting unavailable instead', async () => {
    // nowplaying-cli has been observed to relaunch the last-used player
    // (e.g. Music.app) as a side effect when nothing is currently
    // registered as now-playing -- skip the read entirely rather than risk
    // that, since the result would be "unavailable" either way.
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    const calls: string[] = [];
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      calls.push(command);
      if (command === 'pgrep') return { stdout: '', stderr: '', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('unavailable');
    expect(last.widget.props.nowPlayingIsPlaying).toBe(false);
    expect(last.widget.props.nowPlayingArtwork).toBeNull();
    expect(calls).toContain('pgrep');
    expect(calls).not.toContain('nowplaying-cli');
  });

  it('reads now-playing normally when a known player process is running', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'pgrep') return { stdout: '13399', stderr: '', code: 0 };
      if (command === 'nowplaying-cli') {
        return { stdout: JSON.stringify({ title: 'Real Track', playbackRate: 1 }), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('Real Track');
    expect(last.widget.props.nowPlayingIsPlaying).toBe(true);
  });

  it('renders now-playing as "unavailable" when nowplaying-cli is missing or fails', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'nowplaying-cli') return { stdout: '', stderr: 'command not found', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('unavailable');
  });

  it('renders now-playing as "unavailable" for a title never observed playing (stale registration)', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'nowplaying-cli') {
        return { stdout: JSON.stringify({ title: 'Stale Track Never Seen Playing', playbackRate: null }), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('unavailable');
  });

  it('keeps showing the track as paused (not "unavailable") within the grace window after playback stops', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    let pollCount = 0;
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'nowplaying-cli') {
        pollCount += 1;
        // First poll: actively playing. Every poll after: paused (same title).
        const playbackRate = pollCount === 1 ? 1 : null;
        return { stdout: JSON.stringify({ title: 'Grace Track', playbackRate }), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx); // poll #1: playing
    await vi.advanceTimersByTimeAsync(2000); // poll #2: paused, 2s after playing -- well within the 30s grace window
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('Grace Track');
    expect(last.widget.props.nowPlayingIsPlaying).toBe(false);
  });

  it('reverts to "unavailable" once the paused grace window elapses', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    let pollCount = 0;
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'nowplaying-cli') {
        pollCount += 1;
        const playbackRate = pollCount === 1 ? 1 : null;
        return { stdout: JSON.stringify({ title: 'Grace Track 2', playbackRate }), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx); // poll #1: playing
    await vi.advanceTimersByTimeAsync(32000); // well past the 30s grace window, still paused throughout
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('unavailable');
  });

  it('reads the title from nowplaying-cli regardless of source app, when actively playing', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'nowplaying-cli') {
        return { stdout: JSON.stringify({ title: 'Some Track', playbackRate: 1 }), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlaying).toBe('Some Track');
    expect(last.widget.props.nowPlayingIsPlaying).toBe(true);
  });

  it('exposes artwork as a data URI when playing and artworkData is present', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'nowplaying-cli') {
        return { stdout: JSON.stringify({ title: 'Some Track', playbackRate: 1, artworkData: 'ZmFrZQ==' }), stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlayingArtwork).toBe('data:image/jpeg;base64,ZmFrZQ==');
  });

  it('reports no artwork and not-playing when nothing is playing', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      if (command === 'nowplaying-cli') return { stdout: JSON.stringify({ title: null, playbackRate: null, artworkData: null }), stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    vi.advanceTimersByTime(2000);
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.nowPlayingArtwork).toBeNull();
    expect(last.widget.props.nowPlayingIsPlaying).toBe(false);
  });

  it('forwards play/pause/next/previous actions to nowplaying-cli', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats', 'sys:control-media'] });
    const calls: Array<[string, string[] | undefined]> = [];
    (host.ctx.exec.run as any) = vi.fn(async (command: string, args?: string[]) => {
      calls.push([command, args]);
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    calls.length = 0; // drop the init poll's own exec calls
    await host.onAction('togglePlayPause');
    await host.onAction('next');
    await host.onAction('previous');
    expect(calls).toContainEqual(['nowplaying-cli', ['togglePlayPause']]);
    expect(calls).toContainEqual(['nowplaying-cli', ['next']]);
    expect(calls).toContainEqual(['nowplaying-cli', ['previous']]);
  });

  it('ignores unrecognized action names without touching exec', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats', 'sys:control-media'] });
    const calls: string[] = [];
    (host.ctx.exec.run as any) = vi.fn(async (command: string) => {
      calls.push(command);
      return { stdout: '', stderr: '', code: 0 };
    });
    await systemStatsPlugin.init(host.ctx);
    calls.length = 0;
    await host.onAction('shuffle-everything');
    expect(calls).toEqual([]);
  });

  it('never throws out of init even if exec.run rejects', async () => {
    const host = createFakeHost(systemStatsPlugin, { grantedPermissions: ['sys:read-stats'] });
    (host.ctx.exec.run as any) = vi.fn(async () => { throw new Error('spawn failed'); });
    await expect(systemStatsPlugin.init(host.ctx)).resolves.not.toThrow();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });
});
