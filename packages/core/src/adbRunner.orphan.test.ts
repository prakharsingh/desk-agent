import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

// Real processes, no mocks: a host process (plain node, running adbRunner.ts
// through Node's native type stripping) starts trackDevices against a stub
// "adb" (a long sleep that records its pid). We then end the host in each way
// and assert the stub adb is gone. F3: every core exit used to orphan it.
const modUrl = new URL('./adbRunner.ts', import.meta.url).href;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function until(cond: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return cond();
}

const cleanup: number[] = [];
const hosts: ChildProcess[] = [];
afterEach(() => {
  for (const pid of cleanup.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  for (const h of hosts.splice(0)) { try { h.kill('SIGKILL'); } catch { /* gone */ } }
});

async function startHost(after: string): Promise<{ host: ChildProcess; adbPid: number; exited: Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-orphan-'));
  const adb = path.join(dir, 'adb');
  const pidFile = path.join(dir, 'pid');
  // exec so the recorded pid is the long-lived process itself (what ps would show as adb).
  fs.writeFileSync(adb, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 300\n`);
  fs.chmodSync(adb, 0o755);
  const script = `
    import(${JSON.stringify(modUrl)}).then(({ createRealAdbRunner }) => {
      const t = createRealAdbRunner(() => {}, ${JSON.stringify(adb)}).trackDevices(() => {});
      globalThis.__t = t;
      // Only signal ready (and run the scenario) once the stub adb is really running.
      const fs = require('node:fs');
      const wait = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(pidFile)}) || !fs.readFileSync(${JSON.stringify(pidFile)}, 'utf8').trim()) return;
        clearInterval(wait);
        process.stdout.write('ready\\n');
        ${after}
      }, 20);
    });`;
  const host = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  hosts.push(host);
  const exited = new Promise<void>((r) => host.on('exit', () => r()));
  await new Promise<void>((resolve, reject) => {
    host.stdout!.once('data', () => resolve());
    host.once('exit', () => reject(new Error('host exited before ready')));
  });
  expect(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '')).toBe(true);
  const adbPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  cleanup.push(adbPid);
  expect(alive(adbPid)).toBe(true);
  return { host, adbPid, exited };
}

describe('track-devices never outlives the core (F3)', () => {
  it('dies when the host is SIGKILLed (no JS runs: the stdin-pipe watchdog)', async () => {
    const { host, adbPid, exited } = await startHost('setInterval(() => {}, 1000);');
    host.kill('SIGKILL');
    await exited;
    expect(await until(() => !alive(adbPid))).toBe(true);
  });

  it('dies when the host gets SIGTERM', async () => {
    const { host, adbPid, exited } = await startHost('setInterval(() => {}, 1000);');
    host.kill('SIGTERM');
    await exited;
    expect(await until(() => !alive(adbPid))).toBe(true);
  });

  it('dies when the host calls process.exit() without stop()', async () => {
    const { adbPid, exited } = await startHost('setTimeout(() => process.exit(0), 100);');
    await exited;
    expect(await until(() => !alive(adbPid))).toBe(true);
  });

  it('dies when the host crashes with an uncaught exception', async () => {
    const { adbPid, exited } = await startHost("setTimeout(() => { throw new Error('boom'); }, 100);");
    await exited;
    expect(await until(() => !alive(adbPid))).toBe(true);
  });

  it('stop() kills it while the host keeps running', async () => {
    const { host, adbPid } = await startHost('setTimeout(() => globalThis.__t.stop(), 100); setInterval(() => {}, 1000);');
    expect(await until(() => !alive(adbPid))).toBe(true);
    expect(host.exitCode).toBeNull();
  });

  it('dies when a forked host loses its IPC parent channel (disconnect)', async () => {
    const { host, adbPid } = await startHost('process.emit("disconnect"); setInterval(() => {}, 1000);');
    expect(await until(() => !alive(adbPid))).toBe(true);
    expect(host.exitCode).toBeNull();
  });
});
