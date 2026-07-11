import os from 'node:os';
import type { Ctx, Plugin } from '@desk-agent/plugin-sdk';

const POLL_MS = 2000;

async function readBattery(ctx: Ctx): Promise<string> {
  try {
    const result = await ctx.exec.run('pmset', ['-g', 'batt']);
    if (result.code !== 0) return 'N/A';
    const match = result.stdout.match(/(\d+)%/);
    return match ? `${match[1]}%` : 'N/A';
  } catch {
    return 'N/A';
  }
}

interface NowPlayingInfo {
  nowPlaying: string;
  nowPlayingIsPlaying: boolean;
  nowPlayingArtwork: string | null;
}

const NOW_PLAYING_UNAVAILABLE: NowPlayingInfo = {
  nowPlaying: 'unavailable',
  nowPlayingIsPlaying: false,
  nowPlayingArtwork: null,
};

// playbackRate can't tell "paused a moment ago" apart from "the source app
// quit hours ago" -- MediaRemote reports null/0 for both. Without any
// distinction, gating purely on playbackRate>0 makes a pause button useless
// (the whole card -- including the button to resume -- disappears the
// instant you pause). So: remember the last title we personally observed
// actively playing, and for a bounded window after that, keep showing it
// (paused) even though playbackRate has dropped. Once the window lapses, or
// a title we never saw playing shows up, fall back to the honest
// "unavailable" -- this is what keeps a real stale/dead registration from
// haunting the display forever.
const PAUSED_GRACE_MS = 30000;
let lastPlayingTitle: string | null = null;
let lastPlayingAt = 0;

async function readNowPlaying(ctx: Ctx): Promise<NowPlayingInfo> {
  try {
    // nowplaying-cli reads macOS's system-wide MediaRemote "Now Playing"
    // registration (the same source Control Center's widget uses) instead
    // of addressing one specific app by name. Two things this buys us: (1)
    // it's source-agnostic -- Music, Spotify, and browser tabs playing
    // HTML5 media (YouTube, Spotify Web) all register with the same OS
    // mechanism, so no per-app scripting is needed; (2) it's a passive
    // read with no app to launch, so there's no "tell application" launch
    // side effect to guard against.
    const result = await ctx.exec.run('nowplaying-cli', ['get', '--json', 'title', 'playbackRate', 'artworkData']);
    if (result.code !== 0) return NOW_PLAYING_UNAVAILABLE;
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed !== 'object' || parsed === null) return NOW_PLAYING_UNAVAILABLE;
    const { title, playbackRate, artworkData } = parsed as Record<string, unknown>;
    if (typeof title !== 'string' || !title.trim()) {
      lastPlayingTitle = null;
      return NOW_PLAYING_UNAVAILABLE;
    }
    const trimmedTitle = title.trim();
    const isPlaying = typeof playbackRate === 'number' && playbackRate > 0;
    const now = Date.now();
    if (isPlaying) {
      lastPlayingTitle = trimmedTitle;
      lastPlayingAt = now;
    }
    const withinPausedGrace = trimmedTitle === lastPlayingTitle && now - lastPlayingAt < PAUSED_GRACE_MS;
    if (!isPlaying && !withinPausedGrace) return NOW_PLAYING_UNAVAILABLE;
    return {
      nowPlaying: trimmedTitle,
      nowPlayingIsPlaying: isPlaying,
      nowPlayingArtwork: typeof artworkData === 'string' && artworkData ? `data:image/jpeg;base64,${artworkData}` : null,
    };
  } catch {
    return NOW_PLAYING_UNAVAILABLE;
  }
}

const MEDIA_ACTIONS = new Set(['play', 'pause', 'togglePlayPause', 'next', 'previous']);

async function handleMediaAction(ctx: Ctx, action: string): Promise<void> {
  if (!MEDIA_ACTIONS.has(action)) return;
  try {
    await ctx.exec.run('nowplaying-cli', [action]);
  } catch (err) {
    ctx.log('error', `system-stats media action "${action}" failed: ${String(err)}`);
  }
}

function cpuPercent(): number {
  const loads = os.cpus().map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    return total > 0 ? 1 - cpu.times.idle / total : 0;
  });
  return Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 100);
}

function ramPercent(): number {
  return Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
}

async function poll(ctx: Ctx) {
  try {
    const [battery, nowPlaying] = await Promise.all([readBattery(ctx), readNowPlaying(ctx)]);
    ctx.publishWidget('system-stats', {
      type: 'system-stats',
      props: { cpuPercent: cpuPercent(), ramPercent: ramPercent(), battery, ...nowPlaying },
    });
  } catch (err) {
    ctx.log('error', `system-stats poll failed: ${String(err)}`);
  }
}

let capturedCtx: Ctx | null = null;

const systemStatsPlugin: Plugin = {
  id: 'system-stats',
  permissions: ['sys:read-stats', 'sys:control-media'],
  init(ctx) {
    capturedCtx = ctx;
    ctx.timer.setInterval(() => void poll(ctx), POLL_MS);
    return poll(ctx);
  },
  getWidgets() {
    return [
      {
        type: 'system-stats',
        props: { cpuPercent: cpuPercent(), ramPercent: ramPercent(), battery: 'N/A', ...NOW_PLAYING_UNAVAILABLE },
      },
    ];
  },
  async onAction(action) {
    if (!capturedCtx) return;
    await handleMediaAction(capturedCtx, action);
  },
  onEvent() {},
};

export default systemStatsPlugin;
