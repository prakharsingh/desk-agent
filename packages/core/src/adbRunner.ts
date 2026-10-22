import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LogLevel } from '@desk-agent/plugin-sdk';
import type { AdbRunner } from './tunnelSupervisor.js';

const execFileAsync = promisify(execFile);

// The Android app's package/launcher-activity component id (validated launch
// command: app/android-notes/SLICE1B_SPIKE1.md). MainActivity is
// singleTask, so re-running `am start` against an already-running app just
// brings it to front -- safe to call unconditionally on every dock event.
const APP_COMPONENT = 'com.deskagentapp/.MainActivity';

// User-visible name first (Settings > About phone, e.g. "OnePlus 6T" -- the
// real 6T has no marketname props and a model code of "ONEPLUS A6010"), then
// marketing-name props, then the raw model code. One `adb shell` round-trip:
// each command prints exactly one line (getprop: empty when unset; settings
// get: the literal "null" when unset), so line N <-> source N.
const MODEL_COMMANDS = [
  'settings get global device_name',
  'getprop ro.product.marketname',
  'getprop ro.product.vendor.marketname',
  'getprop ro.product.model',
];

/** First non-empty, non-"null" (trimmed) line of the MODEL_COMMANDS output, or null. */
export function pickModelName(output: string): string | null {
  for (const line of output.split('\n')) {
    const value = line.trim();
    if (value && value !== 'null') return value;
  }
  return null;
}

// track-devices frames are a 4-hex length + that many bytes of device list.
// Four hex digits can't exceed 0xffff, so a 64 KiB cap would never trigger;
// a real list is ~30 bytes per device, so 16 KiB is generous headroom while
// still catching a misaligned prefix that happens to be valid hex (e.g. the
// '78f2' at the start of a serial) before it stalls the parser.
const MAX_TRACK_FRAME_BYTES = 16 * 1024;
const HEX_PREFIX = /^[0-9a-fA-F]{4}$/;

export interface RealAdbRunnerOptions {
  /** Delay before respawning track-devices after a framing desync (tests shrink it). */
  trackRespawnDelayMs?: number;
}

export function createRealAdbRunner(
  onLog: (level: LogLevel, message: string) => void = () => {},
  adbPath = 'adb',
  opts: RealAdbRunnerOptions = {},
): AdbRunner {
  const trackRespawnDelayMs = opts.trackRespawnDelayMs ?? 1000;
  return {
    async reverse(localPort, remotePort) {
      await execFileAsync(adbPath, ['reverse', `tcp:${localPort}`, `tcp:${remotePort}`]);
    },
    async launchApp(serial) {
      const serialArgs = serial ? ['-s', serial] : [];
      await execFileAsync(adbPath, [...serialArgs, 'shell', 'am', 'start', '-n', APP_COMPONENT]);
    },
    async getModel(serial) {
      const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', MODEL_COMMANDS.join('; ')]);
      return pickModelName(stdout);
    },
    trackDevices(onEvent) {
      // Survives respawns: a fresh track-devices stream starts with the full
      // current device list, which reconciles against this (no duplicate
      // attach for a device that stayed, a detach for one that vanished).
      let previouslySeen = new Set<string>();
      let child: ReturnType<typeof spawn> | null = null;
      let respawnTimer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;

      const handlePayload = (payload: string) => {
        const seenNow = new Set<string>();
        for (const line of payload.split('\n')) {
          const [serial, state] = line.trim().split('\t');
          if (!serial || state !== 'device') continue;
          seenNow.add(serial);
          if (!previouslySeen.has(serial)) onEvent({ type: 'attach', serial });
        }
        for (const serial of previouslySeen) {
          if (!seenNow.has(serial)) onEvent({ type: 'detach', serial });
        }
        previouslySeen = seenNow;
      };

      const start = () => {
        const current = spawn(adbPath, ['track-devices']);
        child = current;
        // Without this handler a missing adb binary (spawn ENOENT) is an
        // unhandled 'error' event — an uncaught exception that kills the whole
        // core, not just the tunnel.
        current.on('error', (err) => {
          onLog('error', `adb track-devices failed to start (is adb on PATH?): ${String(err)}`);
        });
        // track-devices uses adb smart-socket framing: each message is a 4-hex
        // length prefix followed by that many BYTES of full device list
        // (`<serial>\t<state>\n` per device; empty list is `0000`). Messages
        // can be split or coalesced across 'data' events, so buffer them --
        // as bytes, so lengths are byte-exact and a multi-byte character split
        // across chunks is decoded only once whole.
        let buffer: Buffer = Buffer.alloc(0);
        current.stdout?.on('data', (chunk: Buffer) => {
          if (child !== current) return; // stale stream, already killed after a desync
          buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
          while (buffer.length >= 4) {
            const prefix = buffer.subarray(0, 4).toString('latin1');
            const len = HEX_PREFIX.test(prefix) ? parseInt(prefix, 16) : NaN;
            if (!(len <= MAX_TRACK_FRAME_BYTES)) {
              // A non-hex prefix used to yield NaN -> slice(NaN) never shrank
              // the buffer -> an infinite synchronous loop that froze the
              // whole core. There is no way to find the next frame boundary
              // in a byte stream, so restart from a fresh, aligned stream.
              buffer = Buffer.alloc(0);
              resync(prefix);
              return;
            }
            if (buffer.length < 4 + len) break;
            const payload = buffer.subarray(4, 4 + len).toString('utf8');
            buffer = buffer.subarray(4 + len);
            handlePayload(payload);
          }
        });
      };

      const resync = (prefix: string) => {
        onLog('warn', `adb track-devices framing desync (bad length prefix ${JSON.stringify(prefix)}); restarting track-devices in ${trackRespawnDelayMs}ms`);
        child?.kill();
        child = null;
        clearTimeout(respawnTimer);
        respawnTimer = setTimeout(() => {
          if (!stopped) start();
        }, trackRespawnDelayMs);
      };

      start();
      return {
        stop: () => {
          stopped = true;
          clearTimeout(respawnTimer);
          child?.kill();
          child = null;
        },
      };
    },
  };
}
