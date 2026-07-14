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

export function createRealAdbRunner(
  onLog: (level: LogLevel, message: string) => void = () => {},
  adbPath = 'adb',
): AdbRunner {
  return {
    async reverse(localPort, remotePort) {
      await execFileAsync(adbPath, ['reverse', `tcp:${localPort}`, `tcp:${remotePort}`]);
    },
    async launchApp(serial) {
      const serialArgs = serial ? ['-s', serial] : [];
      await execFileAsync(adbPath, [...serialArgs, 'shell', 'am', 'start', '-n', APP_COMPONENT]);
    },
    trackDevices(onEvent) {
      const child = spawn(adbPath, ['track-devices']);
      // Without this handler a missing adb binary (spawn ENOENT) is an
      // unhandled 'error' event — an uncaught exception that kills the whole
      // core, not just the tunnel.
      child.on('error', (err) => {
        onLog('error', `adb track-devices failed to start (is adb on PATH?): ${String(err)}`);
      });
      let previouslySeen = new Set<string>();
      child.stdout.on('data', (chunk: Buffer) => {
        const seenNow = new Set<string>();
        for (const line of chunk.toString('utf8').split('\n')) {
          const [serial, state] = line.trim().split('\t');
          if (!serial || state !== 'device') continue;
          seenNow.add(serial);
          if (!previouslySeen.has(serial)) onEvent({ type: 'attach', serial });
        }
        for (const serial of previouslySeen) {
          if (!seenNow.has(serial)) onEvent({ type: 'detach', serial });
        }
        previouslySeen = seenNow;
      });
      return { stop: () => child.kill() };
    },
  };
}
