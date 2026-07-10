import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdbRunner } from './tunnelSupervisor.js';

const execFileAsync = promisify(execFile);

export function createRealAdbRunner(): AdbRunner {
  return {
    async reverse(localPort, remotePort) {
      await execFileAsync('adb', ['reverse', `tcp:${localPort}`, `tcp:${remotePort}`]);
    },
    trackDevices(onEvent) {
      const child = spawn('adb', ['track-devices']);
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
