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

async function readNowPlaying(ctx: Ctx): Promise<string> {
  try {
    const result = await ctx.exec.run('osascript', ['-e', 'tell application "Music" to get name of current track']);
    if (result.code !== 0) return 'unavailable';
    return result.stdout.trim() || 'unavailable';
  } catch {
    return 'unavailable';
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
      props: { cpuPercent: cpuPercent(), ramPercent: ramPercent(), battery, nowPlaying },
    });
  } catch (err) {
    ctx.log('error', `system-stats poll failed: ${String(err)}`);
  }
}

const systemStatsPlugin: Plugin = {
  id: 'system-stats',
  permissions: ['sys:read-stats'],
  init(ctx) {
    ctx.timer.setInterval(() => void poll(ctx), POLL_MS);
    return poll(ctx);
  },
  getWidgets() {
    return [{ type: 'system-stats', props: { cpuPercent: cpuPercent(), ramPercent: ramPercent(), battery: 'N/A', nowPlaying: 'unavailable' } }];
  },
  onAction() {},
  onEvent() {},
};

export default systemStatsPlugin;
