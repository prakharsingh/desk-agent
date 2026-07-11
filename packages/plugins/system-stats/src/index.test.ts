import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import systemStatsPlugin from './index.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('systemStatsPlugin', () => {
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
