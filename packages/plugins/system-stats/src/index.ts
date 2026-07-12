import os, { type CpuInfo } from 'node:os';
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

// Every process nowplaying-cli could plausibly be reading from: native
// players plus common browsers (HTML5 media registers under the browser's
// own process). Substring match (no -x) so browser helper/renderer process
// name variants (e.g. "Google Chrome Helper") still count as "Chrome
// running". Checked before every nowplaying-cli read (see readNowPlaying's
// guard) so the read is skipped entirely when none of these are running --
// i.e. only when nothing could possibly be playing anywhere.
// "Microsoft Edge" (not bare "Edge"): the single word matches unrelated
// macOS background daemons whose names happen to contain "edge" as a
// substring (spotlightknowledged, siriknowledged, knowledge-agent), which
// made this check match almost always regardless of whether a real player
// was running.
const KNOWN_PLAYER_PROCESSES_PATTERN = 'Music|Spotify|Safari|Chrome|Firefox|Brave|Microsoft Edge';

async function isKnownPlayerRunning(ctx: Ctx): Promise<boolean> {
  try {
    const result = await ctx.exec.run('pgrep', ['-i', KNOWN_PLAYER_PROCESSES_PATTERN]);
    return result.code === 0;
  } catch {
    return false;
  }
}

async function readNowPlaying(ctx: Ctx): Promise<NowPlayingInfo> {
  try {
    // nowplaying-cli reads macOS's system-wide MediaRemote "Now Playing"
    // registration (the same source Control Center's widget uses) instead
    // of addressing one specific app by name. That's source-agnostic --
    // Music, Spotify, and browser tabs playing HTML5 media (YouTube,
    // Spotify Web) all register with the same OS mechanism, so no per-app
    // scripting is needed. BUT: on this macOS version, calling it when
    // NOTHING is currently registered as now-playing has been observed to
    // relaunch the last-used native player (Music.app) as a side effect --
    // so skip the call entirely unless some known player/browser process
    // is already running (i.e. unless nothing could possibly be playing).
    if (!(await isKnownPlayerRunning(ctx))) {
      lastPlayingTitle = null;
      return NOW_PLAYING_UNAVAILABLE;
    }
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

// os.cpus()[i].times are cumulative counters since boot, not instantaneous
// values -- a single snapshot's idle/total ratio is the AVERAGE utilization
// since boot, which barely moves between polls seconds apart (on a machine
// up for hours/days it's effectively flat). The load during the most recent
// interval is the DELTA between two snapshots, so the previous poll's
// snapshot must be retained and diffed against the current one.
let prevCpuTimes: CpuInfo['times'][] | null = null;

function cpuPercent(): number {
  const current = os.cpus().map((cpu) => cpu.times);
  const prev = prevCpuTimes;
  prevCpuTimes = current;
  if (!prev || prev.length !== current.length) return 0;
  const loads = current.map((times, i) => {
    const idleDelta = times.idle - prev[i].idle;
    const totalDelta = Object.keys(times).reduce((sum, key) => sum + (times[key as keyof typeof times] - prev[i][key as keyof typeof times]), 0);
    return totalDelta > 0 ? 1 - idleDelta / totalDelta : 0;
  });
  return Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 100);
}

function ramPercent(): number {
  return Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
}

// Mirrors the last poll's result so getWidgets() (answering the hello
// snapshot on every connect/reconnect) reflects actually-known state instead
// of a hardcoded placeholder -- otherwise every reconnect would briefly show
// wrong data even after the plugin has long since observed the real values.
let lastBattery = 'N/A';
let lastNowPlaying: NowPlayingInfo = NOW_PLAYING_UNAVAILABLE;

async function poll(ctx: Ctx) {
  try {
    const [battery, nowPlaying] = await Promise.all([readBattery(ctx), readNowPlaying(ctx)]);
    lastBattery = battery;
    lastNowPlaying = nowPlaying;
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
        props: { cpuPercent: cpuPercent(), ramPercent: ramPercent(), battery: lastBattery, ...lastNowPlaying },
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
