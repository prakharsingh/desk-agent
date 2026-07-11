import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdbRunner } from './tunnelSupervisor.js';

const execFileAsync = promisify(execFile);

export function createRealAdbRunner(
  onLog: (level: string, message: string) => void = () => {},
  adbPath = 'adb',
): AdbRunner {
  return {
    async reverse(localPort, remotePort) {
      await execFileAsync(adbPath, ['reverse', `tcp:${localPort}`, `tcp:${remotePort}`]);
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
