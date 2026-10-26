import { spawn, execFile, type ChildProcess } from 'node:child_process';
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

/** Pure: one `<serial>\t<state>` entry per line of a track-devices payload; blank/malformed lines are skipped. */
export function parseDeviceList(payload: string): Array<{ serial: string; state: string }> {
  const out: Array<{ serial: string; state: string }> = [];
  for (const line of payload.split('\n')) {
    const [serial, state] = line.trim().split('\t');
    if (serial && state) out.push({ serial, state });
  }
  return out;
}

// Serial and token/session values are interpolated into a shell command line
// sent over stdin, so they are restricted to a metacharacter-free alphabet.
const SAFE_VALUE = /^[A-Za-z0-9-]{1,128}$/;

/**
 * Deadline for every one-shot adb exec (reverse, reverse --remove, am start, getprop): Node kills the child and the
 * call rejects. Without it one hung adb would wedge that port's ordered operation chain (TunnelSupervisor) for good.
 */
export const ADB_EXEC_TIMEOUT_MS = 10_000;

export interface RealAdbRunnerOptions {
  /** Delay before respawning track-devices after a framing desync (tests shrink it). */
  trackRespawnDelayMs?: number;
  /** Deadline for deliverDisplayToken's `adb shell` (default 10000; tests shrink it). */
  deliverTimeoutMs?: number;
  /** Deadline for the one-shot adb execs (default ADB_EXEC_TIMEOUT_MS; tests shrink it). */
  execTimeoutMs?: number;
}

// ---- track-devices child lifetime -----------------------------------------
// `adb track-devices` is a long-lived child. It must never outlive the core:
// every orphan keeps an adb-server connection open forever (F3: 86 leaked).
// Two independent layers:
//  1. In-process: every live tracker is registered here and killed
//     SYNCHRONOUSLY (kill is sync, so it works inside a 'exit' handler) on
//     exit, disconnect, SIGTERM/SIGINT/SIGHUP and (via 'exit') a crash.
//  2. Out-of-process: the child is a /bin/sh wrapper that keeps our stdin
//     pipe open and kills adb when that pipe hits EOF. EOF is delivered by the
//     kernel when the core dies by ANY means, including SIGKILL, where no JS
//     runs (adb itself ignores its stdin, so it cannot notice by itself).
//     Script: fd3 = our stdin pipe; a background watcher blocks reading it and
//     kills adb on EOF; the foreground waits for adb, then ends the whole group
//     (so the watcher's cat cannot linger) while preserving adb's exit code.
const TRACK_WRAPPER_SCRIPT =
  'exec 3<&0; "$0" track-devices 3<&- & p=$!; (cat <&3 >/dev/null; kill $p 2>/dev/null) & ' +
  'wait $p; rc=$?; trap \'exit $rc\' TERM; kill 0';

const liveTrackers = new Set<ChildProcess>();

/** Synchronously kill a tracker (the whole wrapper group: sh, adb, cat). */
function killTracker(child: ChildProcess): void {
  try {
    if (typeof child.pid === 'number') process.kill(-child.pid, 'SIGTERM');
    else child.kill();
  } catch {
    try { child.kill(); } catch { /* already gone */ }
  }
}

/** Kill every tracker this process started. Safe to call repeatedly and from an 'exit' handler. */
export function killAllTrackers(): void {
  for (const child of [...liveTrackers]) killTracker(child);
  liveTrackers.clear();
}

const GUARD_SIGNALS: Array<[NodeJS.Signals, number]> = [['SIGTERM', 15], ['SIGINT', 2], ['SIGHUP', 1]];
let guardedProcess: NodeJS.Process | undefined;

/** Idempotent per process object. Exported with an injectable process for tests. */
export function installTrackerExitGuards(proc: NodeJS.Process = process): void {
  if (guardedProcess === proc) return;
  guardedProcess = proc;
  // 'exit' also runs after an uncaught exception's default crash, and after process.exit().
  proc.on('exit', killAllTrackers);
  // IPC channel to a parent closed (node child_process.fork host).
  proc.on('disconnect', killAllTrackers);
  for (const [signal, num] of GUARD_SIGNALS) {
    proc.on(signal, () => {
      killAllTrackers();
      // Adding a signal listener removes Node's default "terminate". Restore it
      // unless someone else also listens (they own the shutdown then).
      if (proc.listenerCount(signal) === 1) proc.exit(128 + num);
    });
  }
}

export function createRealAdbRunner(
  onLog: (level: LogLevel, message: string) => void = () => {},
  adbPath = 'adb',
  opts: RealAdbRunnerOptions = {},
): AdbRunner {
  const trackRespawnDelayMs = opts.trackRespawnDelayMs ?? 1000;
  const deliverTimeoutMs = opts.deliverTimeoutMs ?? 10_000;
  const execOpts = { timeout: opts.execTimeoutMs ?? ADB_EXEC_TIMEOUT_MS };
  return {
    async reverse(localPort, remotePort, serial) {
      const serialArgs = serial ? ['-s', serial] : [];
      await execFileAsync(adbPath, [...serialArgs, 'reverse', `tcp:${localPort}`, `tcp:${remotePort}`], execOpts);
    },
    // Never rejects: a stale reverse is harmless enough that teardown must not fail its caller.
    async removeReverse(port, serial) {
      const serialArgs = serial ? ['-s', serial] : [];
      try {
        await execFileAsync(adbPath, [...serialArgs, 'reverse', '--remove', `tcp:${port}`], execOpts);
      } catch (err) {
        onLog('warn', `adb reverse --remove tcp:${port} failed: ${String(err)}`);
      }
    },
    // The token goes over stdin to `adb shell`, never argv (visible in `ps`).
    async deliverDisplayToken(serial, sessionId, token) {
      if (!SAFE_VALUE.test(sessionId) || !SAFE_VALUE.test(token)) {
        throw new Error('invalid display session id or token');
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(adbPath, ['-s', serial, 'shell']);
        let output = '';
        let settled = false;
        const redact = (text: string) => text.split(token).join('***').split(sessionId).join('***');
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (err) reject(err); else resolve();
        };
        const timer = setTimeout(() => {
          child.kill();
          finish(new Error(`adb shell timed out after ${deliverTimeoutMs}ms delivering the display token`));
        }, deliverTimeoutMs);
        child.stdout?.on('data', (c: Buffer) => { output += c.toString('utf8'); });
        child.stderr?.on('data', (c: Buffer) => { output += c.toString('utf8'); });
        child.on('error', (err) => finish(err));
        child.on('close', (code) => {
          if (code !== 0) finish(new Error(`adb shell exited with code ${code}`));
          else if (output.includes('Error:')) finish(new Error(`am start failed: ${redact(output.trim())}`));
          else finish();
        });
        // EPIPE if adb dies early surfaces via 'close'/'error' above.
        child.stdin?.on('error', () => {});
        child.stdin?.end(`am start -n ${APP_COMPONENT} --es displayToken ${token} --es displaySessionId ${sessionId}\nexit\n`);
      });
    },
    async launchApp(serial) {
      const serialArgs = serial ? ['-s', serial] : [];
      await execFileAsync(adbPath, [...serialArgs, 'shell', 'am', 'start', '-n', APP_COMPONENT], execOpts);
    },
    async getModel(serial) {
      const { stdout } = await execFileAsync(adbPath, ['-s', serial, 'shell', MODEL_COMMANDS.join('; ')], execOpts);
      return pickModelName(stdout);
    },
    trackDevices(onEvent) {
      // Survives respawns: a fresh track-devices stream starts with the full
      // current device list, which reconciles against this (no duplicate
      // attach for a device that stayed, a detach for one that vanished).
      let previouslySeen = new Set<string>();
      let previouslyUnauthorized = new Set<string>();
      let child: ReturnType<typeof spawn> | null = null;
      let respawnTimer: ReturnType<typeof setTimeout> | undefined;
      let stopped = false;

      const handlePayload = (payload: string) => {
        const seenNow = new Set<string>();
        const unauthorizedNow = new Set<string>();
        for (const { serial, state } of parseDeviceList(payload)) {
          if (state === 'unauthorized') {
            unauthorizedNow.add(serial);
            continue;
          }
          if (state !== 'device') continue;
          seenNow.add(serial);
          if (!previouslySeen.has(serial)) onEvent({ type: 'attach', serial });
        }
        for (const serial of previouslySeen) {
          if (!seenNow.has(serial)) onEvent({ type: 'detach', serial });
        }
        // An unauthorized-only serial that vanished must still be reported
        // gone, or consumers keep showing "tap Allow" for a phone that left.
        for (const serial of previouslyUnauthorized) {
          if (!unauthorizedNow.has(serial) && !seenNow.has(serial)) onEvent({ type: 'detach', serial });
        }
        for (const serial of unauthorizedNow) {
          if (!previouslyUnauthorized.has(serial)) onEvent({ type: 'unauthorized', serial });
        }
        previouslySeen = seenNow;
        previouslyUnauthorized = unauthorizedNow;
      };

      const start = () => {
        // detached: own process group, so killTracker can take down sh+adb+cat together.
        const current = spawn('/bin/sh', ['-c', TRACK_WRAPPER_SCRIPT, adbPath], { detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
        child = current;
        if (typeof current.pid === 'number') {
          liveTrackers.add(current);
          current.on('exit', () => liveTrackers.delete(current));
          installTrackerExitGuards();
        }
        // The open stdin pipe IS the parent-death signal; never end it, ignore EPIPE.
        current.stdin?.on('error', () => {});
        // The wrapper reports adb's own exit code (127 = adb not found). Only an
        // exit we did not cause (stop/resync null `child` first) is worth a log.
        current.on('exit', (code) => {
          if (child !== current || stopped) return;
          onLog('error', `adb track-devices exited unexpectedly (code ${code ?? 'signal'}${code === 127 ? '; is adb on PATH?' : ''})`);
        });
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
        if (child) killTracker(child);
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
          if (child) killTracker(child);
          child = null;
        },
      };
    },
  };
}
