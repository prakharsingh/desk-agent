import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRealAdbRunner, parseDeviceList, ADB_EXEC_TIMEOUT_MS } from './adbRunner.js';
import { TunnelSupervisor, type AdbRunner } from './tunnelSupervisor.js';

// spawn passes through to the real implementation unless a test installs a
// fake child (trackDevices framing tests), so the real-binary tests below are
// unaffected.
let fakeChild: (EventEmitter & { stdout: EventEmitter; kill: () => void }) | null = null;
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => fakeChild ?? actual.spawn(...args),
  };
});

describe('createRealAdbRunner', () => {
  it('logs an error and does not crash when the adb binary is missing', async () => {
    const onLog = vi.fn();
    const runner = createRealAdbRunner(onLog, '/nonexistent/definitely-not-adb');
    const tracker = runner.trackDevices(() => {});
    await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('adb')));
    expect(() => tracker.stop()).not.toThrow();
  });

  describe('launchApp', () => {
    // A real stub "adb" script (not a mocked execFile) recording the argv it
    // was invoked with, matching this file's existing style of exercising
    // createRealAdbRunner against a real binary path rather than mocking
    // node:child_process.
    function stubAdb(): { adbPath: string; argsFile: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-adb-stub-'));
      const adbPath = path.join(dir, 'adb');
      const argsFile = path.join(dir, 'args');
      fs.writeFileSync(adbPath, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "' + argsFile + '"\n');
      fs.chmodSync(adbPath, 0o755);
      return { adbPath, argsFile };
    }

    it('starts com.deskagentapp/.MainActivity, scoped to the given serial', async () => {
      const { adbPath, argsFile } = stubAdb();
      const runner = createRealAdbRunner(vi.fn(), adbPath);
      await runner.launchApp('phone1');
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      expect(args).toEqual(['-s', 'phone1', 'shell', 'am', 'start', '-n', 'com.deskagentapp/.MainActivity']);
    });

    it('omits -s <serial> when no serial is known', async () => {
      const { adbPath, argsFile } = stubAdb();
      const runner = createRealAdbRunner(vi.fn(), adbPath);
      await runner.launchApp(null);
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      expect(args).toEqual(['shell', 'am', 'start', '-n', 'com.deskagentapp/.MainActivity']);
    });

    it('rejects when the adb binary is missing (caller/TunnelSupervisor handles the failure)', async () => {
      const runner = createRealAdbRunner(vi.fn(), '/nonexistent/definitely-not-adb');
      await expect(runner.launchApp('phone1')).rejects.toThrow();
    });
  });

  describe('getModel', () => {
    // Same real-stub-binary style as launchApp above: the stub records its
    // argv and prints canned getprop output (one line per queried prop, empty
    // when the prop is unset -- exactly what `getprop <name>` does on-device).
    function stubAdb(stdout: string, exitCode = 0): { adbPath: string; argsFile: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-adb-model-stub-'));
      const adbPath = path.join(dir, 'adb');
      const argsFile = path.join(dir, 'args');
      const outFile = path.join(dir, 'out');
      fs.writeFileSync(outFile, stdout);
      fs.writeFileSync(adbPath, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\ncat "${outFile}"\nexit ${exitCode}\n`);
      fs.chmodSync(adbPath, 0o755);
      return { adbPath, argsFile };
    }

    it('runs a single adb shell command, scoped to the serial: settings device_name, then marketname, vendor marketname, model', async () => {
      const { adbPath, argsFile } = stubAdb('null\n\n\nONEPLUS A6013\n');
      await createRealAdbRunner(vi.fn(), adbPath).getModel!('78f2af2a');
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      expect(args).toEqual([
        '-s', '78f2af2a', 'shell',
        'settings get global device_name; getprop ro.product.marketname; getprop ro.product.vendor.marketname; getprop ro.product.model',
      ]);
    });

    it('prefers the user-visible device_name (Settings > About phone) over every getprop', async () => {
      // The real OnePlus 6T: no marketname props, model code ONEPLUS A6010.
      const { adbPath } = stubAdb('OnePlus 6T\n\n\nONEPLUS A6010\n');
      await expect(createRealAdbRunner(vi.fn(), adbPath).getModel!('s')).resolves.toBe('OnePlus 6T');
    });

    it('skips a literal "null" device_name (what `settings get` prints when unset)', async () => {
      const { adbPath } = stubAdb('null\nPixel 4a\n\nsunfish\n');
      await expect(createRealAdbRunner(vi.fn(), adbPath).getModel!('s')).resolves.toBe('Pixel 4a');
    });

    it('falls back to ro.product.model when device_name is null and no marketname is set', async () => {
      const { adbPath } = stubAdb('null\r\n\r\n\r\nONEPLUS A6010\r\n');
      await expect(createRealAdbRunner(vi.fn(), adbPath).getModel!('s')).resolves.toBe('ONEPLUS A6010');
    });

    it('prefers ro.product.marketname when device_name is empty', async () => {
      const { adbPath } = stubAdb('\nOnePlus 6T\nOnePlus 6T (vendor)\nONEPLUS A6013\n');
      await expect(createRealAdbRunner(vi.fn(), adbPath).getModel!('s')).resolves.toBe('OnePlus 6T');
    });

    it('falls back to ro.product.vendor.marketname, then ro.product.model, trimming whitespace / CRLF', async () => {
      const { adbPath: vendor } = stubAdb('\r\n\r\n  Pixel 4a  \r\nsunfish\r\n');
      await expect(createRealAdbRunner(vi.fn(), vendor).getModel!('s')).resolves.toBe('Pixel 4a');
      const { adbPath: model } = stubAdb('\n\n   \n ONEPLUS A6013 \n');
      await expect(createRealAdbRunner(vi.fn(), model).getModel!('s')).resolves.toBe('ONEPLUS A6013');
    });

    it('resolves null when nothing is set', async () => {
      const { adbPath } = stubAdb('null\n\n\n\n');
      await expect(createRealAdbRunner(vi.fn(), adbPath).getModel!('s')).resolves.toBeNull();
    });

    it('rejects when adb fails (TunnelSupervisor handles it non-fatally)', async () => {
      const { adbPath } = stubAdb('', 1);
      await expect(createRealAdbRunner(vi.fn(), adbPath).getModel!('s')).rejects.toThrow();
    });
  });

  describe('reverse and deliverDisplayToken (stub adb recording argv + stdin)', () => {
    function stubAdb(stdout = '', exitCode = 0) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-adb-rev-stub-'));
      const adbPath = path.join(dir, 'adb');
      const argsFile = path.join(dir, 'args');
      const stdinFile = path.join(dir, 'stdin');
      fs.writeFileSync(adbPath, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nfor a in "$@"; do [ "$a" = shell ] && cat > "${stdinFile}"; done\nprintf '%s' '${stdout}'\nexit ${exitCode}\n`);
      fs.chmodSync(adbPath, 0o755);
      const args = () => fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      const stdin = () => fs.readFileSync(stdinFile, 'utf8');
      return { adbPath, argsFile, args, stdin };
    }

    it('scopes reverse to the serial', async () => {
      const { adbPath, args } = stubAdb();
      await createRealAdbRunner(vi.fn(), adbPath).reverse(8788, 8788, 'phone1');
      expect(args()).toEqual(['-s', 'phone1', 'reverse', 'tcp:8788', 'tcp:8788']);
    });

    it('omits -s for reverse when no serial is known', async () => {
      const { adbPath, args } = stubAdb();
      await createRealAdbRunner(vi.fn(), adbPath).reverse(8787, 8787, null);
      expect(args()).toEqual(['reverse', 'tcp:8787', 'tcp:8787']);
    });

    it('removeReverse runs `adb -s <serial> reverse --remove tcp:<port>`', async () => {
      const { adbPath, args } = stubAdb();
      await createRealAdbRunner(vi.fn(), adbPath).removeReverse(8788, 'phone1');
      expect(args()).toEqual(['-s', 'phone1', 'reverse', '--remove', 'tcp:8788']);
    });

    it('removeReverse omits -s when no serial is known', async () => {
      const { adbPath, args } = stubAdb();
      await createRealAdbRunner(vi.fn(), adbPath).removeReverse(8788, null);
      expect(args()).toEqual(['reverse', '--remove', 'tcp:8788']);
    });

    describe('exec timeout (a hung adb never wedges the caller)', () => {
      // A stub adb that hangs (exec sleep) while a "hang" marker file exists, consuming the marker; otherwise it records argv.
      function hangingAdb() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-adb-hang-'));
        const adbPath = path.join(dir, 'adb');
        const log = path.join(dir, 'calls');
        const marker = path.join(dir, 'hang');
        fs.writeFileSync(adbPath, `#!/bin/sh\nif [ -f "${marker}" ]; then rm -f "${marker}"; exec sleep 30; fi\necho "$*" >> "${log}"\n`);
        fs.chmodSync(adbPath, 0o755);
        return { adbPath, hangNext: () => fs.writeFileSync(marker, ''), calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
      }

      it('defaults to a 10 s exec timeout', () => {
        expect(ADB_EXEC_TIMEOUT_MS).toBe(10_000);
      });

      it('rejects reverse, launchApp and getModel once a hung adb exceeds the exec timeout', async () => {
        const h = hangingAdb();
        const runner = createRealAdbRunner(vi.fn(), h.adbPath, { execTimeoutMs: 1_000 });
        h.hangNext();
        const t0 = Date.now();
        await expect(runner.reverse(8788, 8788, 'phone1')).rejects.toThrow();
        expect(Date.now() - t0).toBeLessThan(8_000); // killed at the deadline, not after the 30 s sleep
        h.hangNext();
        await expect(runner.launchApp('phone1')).rejects.toThrow();
        h.hangNext();
        await expect(runner.getModel!('phone1')).rejects.toThrow();
      }, 20_000);

      it('removeReverse resolves (and logs) once a hung adb exceeds the exec timeout', async () => {
        const h = hangingAdb();
        const onLog = vi.fn();
        h.hangNext();
        await expect(createRealAdbRunner(onLog, h.adbPath, { execTimeoutMs: 1_000 }).removeReverse(8788, 'phone1')).resolves.toBeUndefined();
        expect(onLog).toHaveBeenCalledWith('warn', expect.stringContaining('tcp:8788'));
      });

      it("a hung reverse fails the port's waiter and the next queued op for that port still runs", async () => {
        const h = hangingAdb();
        // Generous enough for a cold stub exec under a loaded parallel test run, still far below the 30 s hang.
        const real = createRealAdbRunner(vi.fn(), h.adbPath, { execTimeoutMs: 1_500 });
        let emit!: (e: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void;
        const adb: AdbRunner = {
          reverse: (l, r, serial) => real.reverse(l, r, serial),
          removeReverse: (port, serial) => real.removeReverse(port, serial),
          deliverDisplayToken: vi.fn(async () => {}),
          launchApp: vi.fn(async () => {}),
          trackDevices: (onEvent) => { emit = onEvent; return { stop: vi.fn() }; },
        };
        const sup = new TunnelSupervisor(adb, 8787, vi.fn(), false);
        sup.start();
        emit({ type: 'attach', serial: 'phone1' });
        await vi.waitFor(() => expect(sup.getStatus().tunnelStatus).toBe('reissued'), { timeout: 5_000 });
        h.hangNext();
        const added = sup.addPort(8788);
        const outcome = sup.waitForPort(8788, 60_000);
        await expect(outcome).resolves.toBe('failed'); // the coordinator maps this to port-in-use
        await expect(added).resolves.toBe(false);
        // The chain advanced: the next op for the port runs, and a fresh add works normally.
        sup.removePort(8788);
        await vi.waitFor(() => expect(h.calls()).toContain('-s phone1 reverse --remove tcp:8788'), { timeout: 5_000 });
        await expect(sup.addPort(8788)).resolves.toBe(true);
        expect(h.calls()).toContain('-s phone1 reverse tcp:8788 tcp:8788');
      }, 20_000);
    });

    it('removeReverse never rejects: a failing adb is logged as a warning', async () => {
      const { adbPath } = stubAdb('', 1);
      const onLog = vi.fn();
      await expect(createRealAdbRunner(onLog, adbPath).removeReverse(8788, 'phone1')).resolves.toBeUndefined();
      expect(onLog).toHaveBeenCalledWith('warn', expect.stringContaining('tcp:8788'));
      const missing = vi.fn();
      await expect(createRealAdbRunner(missing, '/nonexistent/definitely-not-adb').removeReverse(8788, 'phone1')).resolves.toBeUndefined();
      expect(missing).toHaveBeenCalledWith('warn', expect.stringContaining('tcp:8788'));
    });

    it('delivers the token on stdin, never in argv', async () => {
      const { adbPath, args, stdin } = stubAdb();
      await createRealAdbRunner(vi.fn(), adbPath).deliverDisplayToken('phone1', 's-1', 'abc123');
      expect(args()).toEqual(['-s', 'phone1', 'shell']);
      expect(args().join(' ')).not.toContain('abc123');
      expect(stdin()).toBe('am start -n com.deskagentapp/.MainActivity --es displayToken abc123 --es displaySessionId s-1\nexit\n');
    });

    it('refuses values with shell metacharacters without spawning', async () => {
      const { adbPath, argsFile } = stubAdb();
      const runner = createRealAdbRunner(vi.fn(), adbPath);
      await expect(runner.deliverDisplayToken('phone1', 's;rm', 'x')).rejects.toThrow(/invalid/);
      await expect(runner.deliverDisplayToken('phone1', 's-1', 'a b')).rejects.toThrow(/invalid/);
      await expect(runner.deliverDisplayToken('phone1', 's-1', '')).rejects.toThrow(/invalid/);
      expect(fs.existsSync(argsFile)).toBe(false);
    });

    it('rejects when am reports an Error (exit 0)', async () => {
      const { adbPath } = stubAdb('Error: Activity class does not exist');
      await expect(createRealAdbRunner(vi.fn(), adbPath).deliverDisplayToken('phone1', 's-1', 'abc')).rejects.toThrow(/Error:/);
    });

    it('rejects on a non-zero exit', async () => {
      const { adbPath } = stubAdb('', 1);
      await expect(createRealAdbRunner(vi.fn(), adbPath).deliverDisplayToken('phone1', 's-1', 'abc')).rejects.toThrow();
    });

    it('redacts the token and session id from the rejection message', async () => {
      const { adbPath } = stubAdb('Error: bad --es displayToken tok123 sess-9');
      const err = await createRealAdbRunner(vi.fn(), adbPath).deliverDisplayToken('phone1', 'sess-9', 'tok123').then(() => new Error('resolved'), (e: Error) => e);
      expect(err.message).toMatch(/Error:/);
      expect(err.message).not.toContain('tok123');
      expect(err.message).not.toContain('sess-9');
    });

    it('kills adb and rejects when the shell never exits (timeout)', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-adb-hang-'));
      const adbPath = path.join(dir, 'adb');
      fs.writeFileSync(adbPath, '#!/bin/sh\nsleep 30\n');
      fs.chmodSync(adbPath, 0o755);
      const runner = createRealAdbRunner(vi.fn(), adbPath, { deliverTimeoutMs: 150 });
      const t0 = Date.now();
      await expect(runner.deliverDisplayToken('phone1', 's-1', 'abc')).rejects.toThrow(/timed out/);
      expect(Date.now() - t0).toBeLessThan(3000);
    });

    it('rejects when adb is missing', async () => {
      const runner = createRealAdbRunner(vi.fn(), '/nonexistent/definitely-not-adb');
      await expect(runner.deliverDisplayToken('phone1', 's-1', 'abc')).rejects.toThrow();
    });
  });

  describe('parseDeviceList', () => {
    it('reports unauthorized devices', () => {
      expect(parseDeviceList('abc\tunauthorized\nxyz\tdevice\n')).toEqual([{ serial: 'abc', state: 'unauthorized' }, { serial: 'xyz', state: 'device' }]);
    });
    it('skips blank and malformed lines and trims CRLF', () => {
      expect(parseDeviceList('\nlonely\nabc\tdevice\r\n')).toEqual([{ serial: 'abc', state: 'device' }]);
    });
  });

  describe('trackDevices (adb smart-socket framing: 4-hex length + payload)', () => {
    type TrackEvent = { type: string; serial: string };

    function track(chunks: string[]): TrackEvent[] {
      fakeChild = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => {} });
      const child = fakeChild;
      const events: TrackEvent[] = [];
      createRealAdbRunner(vi.fn(), 'adb').trackDevices((e) => events.push(e));
      fakeChild = null;
      for (const c of chunks) child.stdout.emit('data', Buffer.from(c, 'utf8'));
      return events;
    }

    function frame(payload: string): string {
      return Buffer.byteLength(payload, 'utf8').toString(16).padStart(4, '0') + payload;
    }

    // A desync regression is an infinite SYNCHRONOUS loop on the 'data'
    // handler -- it would freeze this test worker itself, so no vitest
    // timeout could ever fire. These cases therefore run the real source in
    // a worker thread (Node strips the .ts types natively) with a hard
    // deadline: Worker.terminate() interrupts even a busy loop.
    type Step = string | { waitForSpawns: number } | { onFirstChild: string };
    async function boundedTrack(steps: Step[], timeoutMs = 3000): Promise<{ events: TrackEvent[]; logs: Array<[string, string]>; spawns: number; kills: number }> {
      const { Worker } = await import('node:worker_threads');
      const modUrl = new URL('./adbRunner.ts', import.meta.url).href;
      const src = `
        const { parentPort, workerData } = require('node:worker_threads');
        const { EventEmitter } = require('node:events');
        const cp = require('node:child_process');
        const { syncBuiltinESMExports } = require('node:module');
        let spawns = 0;
        let kills = 0;
        let child;
        const children = [];
        cp.spawn = () => {
          spawns++;
          child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => { kills++; } });
          children.push(child);
          return child;
        };
        syncBuiltinESMExports();
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        import(workerData.modUrl).then(async ({ createRealAdbRunner }) => {
          const events = [];
          const logs = [];
          const tracker = createRealAdbRunner((level, message) => logs.push([level, message]), 'adb', { trackRespawnDelayMs: 20 })
            .trackDevices((e) => events.push(e));
          for (const step of workerData.steps) {
            if (typeof step === 'string') child.stdout.emit('data', Buffer.from(step, 'utf8'));
            else if ('onFirstChild' in step) children[0].stdout.emit('data', Buffer.from(step.onFirstChild, 'utf8'));
            else while (spawns < step.waitForSpawns) await sleep(5);
          }
          tracker.stop();
          parentPort.postMessage({ events, logs, spawns, kills });
        }).catch((err) => parentPort.postMessage({ error: String((err && err.stack) || err) }));
      `;
      const worker = new Worker(src, { eval: true, workerData: { modUrl, steps } });
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`trackDevices did not return within ${timeoutMs}ms (event loop frozen)`)), timeoutMs);
          worker.once('message', (msg) => {
            clearTimeout(timer);
            if (msg.error) reject(new Error(msg.error));
            else resolve(msg);
          });
          worker.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      } finally {
        await worker.terminate();
      }
    }

    it('boundedTrack harness itself works on a well-formed stream', async () => {
      const { events, spawns } = await boundedTrack([frame('78f2af2a\tdevice\n')]);
      expect(events).toEqual([{ type: 'attach', serial: '78f2af2a' }]);
      expect(spawns).toBe(1);
    });

    // Recovery = kill the desynced track-devices and respawn it: a fresh
    // stream is frame-aligned by construction and adb sends the full current
    // device list first, so previouslySeen reconciles without a gap.
    it('a non-hex length prefix does not freeze the event loop: logs a desync warning, respawns track-devices, and parses the new stream', async () => {
      const { events, logs, spawns, kills } = await boundedTrack(['zzzz', { waitForSpawns: 2 }, frame('78f2af2a\tdevice\n')]);
      expect(logs.some(([level, msg]) => level === 'warn' && /desync/i.test(msg))).toBe(true);
      expect(spawns).toBe(2);
      expect(kills).toBeGreaterThanOrEqual(1);
      expect(events).toEqual([{ type: 'attach', serial: '78f2af2a' }]);
    });

    it('stray text before the first frame is treated as a desync and recovers on the respawned stream', async () => {
      const { events, logs } = await boundedTrack(['* daemon not running; starting now at tcp:5037\n', { waitForSpawns: 2 }, frame('78f2af2a\tdevice\n')]);
      expect(logs.some(([level, msg]) => level === 'warn' && /desync/i.test(msg))).toBe(true);
      expect(events).toEqual([{ type: 'attach', serial: '78f2af2a' }]);
    });

    it('treats an oversized length (above the 16 KiB cap) as a desync rather than waiting forever for the payload', async () => {
      // 'ffff' is valid hex (65535) but far beyond any real device list.
      // Without the cap the parser would buffer everything after it and
      // never see the following frame.
      const { events, logs } = await boundedTrack(['ffff', { waitForSpawns: 2 }, frame('78f2af2a\tdevice\n')]);
      expect(logs.some(([level, msg]) => level === 'warn' && /desync/i.test(msg))).toBe(true);
      expect(events).toEqual([{ type: 'attach', serial: '78f2af2a' }]);
    });

    it('a partially-hex prefix (parseInt would read 000z as 0 = empty list) is a desync, not a detach-everything', async () => {
      const { events, logs } = await boundedTrack([
        frame('aaaa1111\tdevice\n'),
        '000z',
        { waitForSpawns: 2 },
        frame('aaaa1111\tdevice\n'),
      ]);
      expect(logs.some(([level, msg]) => level === 'warn' && /desync/i.test(msg))).toBe(true);
      expect(events).toEqual([{ type: 'attach', serial: 'aaaa1111' }]);
    });

    it('a device seen before a desync is not re-attached by the respawned stream, and a vanished one is detached', async () => {
      const { events } = await boundedTrack([
        frame('aaaa1111\tdevice\nbbbb2222\tdevice\n'),
        'zz',
        'zz',
        { waitForSpawns: 2 },
        frame('aaaa1111\tdevice\n'),
      ]);
      expect(events).toEqual([
        { type: 'attach', serial: 'aaaa1111' },
        { type: 'attach', serial: 'bbbb2222' },
        { type: 'detach', serial: 'bbbb2222' },
      ]);
    });

    it('the rest of a desynced chunk is dropped, and late data on the killed (stale) child is ignored', async () => {
      const { events, spawns } = await boundedTrack([
        'zzzz' + frame('cccc3333\tdevice\n'),
        { waitForSpawns: 2 },
        { onFirstChild: frame('dddd4444\tdevice\n') },
        frame('aaaa1111\tdevice\n'),
      ]);
      expect(events).toEqual([{ type: 'attach', serial: 'aaaa1111' }]);
      expect(spawns).toBe(2);
    });

    it('frames by BYTES, not UTF-16 chars: a multi-byte serial does not desync the following frame', () => {
      const first = 'é1\tdevice\n'; // 'é' is 2 bytes in UTF-8
      expect(track([frame(first) + frame('78f2af2a\tdevice\n')])).toEqual([
        { type: 'attach', serial: 'é1' },
        { type: 'attach', serial: '78f2af2a' },
        { type: 'detach', serial: 'é1' },
      ]);
    });

    it('a multi-byte character split across two data chunks is decoded intact', () => {
      const payload = 'é1\tdevice\n';
      const bytes = Buffer.from(frame(payload), 'utf8');
      // Split inside the 2-byte 'é' (prefix is 4 bytes, so byte 5 is mid-char).
      fakeChild = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => {} });
      const child = fakeChild;
      const events: TrackEvent[] = [];
      createRealAdbRunner(vi.fn(), 'adb').trackDevices((e) => events.push(e));
      fakeChild = null;
      child.stdout.emit('data', bytes.subarray(0, 5));
      child.stdout.emit('data', bytes.subarray(5));
      expect(events).toEqual([{ type: 'attach', serial: 'é1' }]);
    });

    it('dedups across repeated lists: two identical lists then a list with one extra device -> exactly one attach per serial', () => {
      const one = 'aaaa1111\tdevice\n';
      const two = 'aaaa1111\tdevice\nbbbb2222\tdevice\n';
      expect(track([frame(one), frame(one), frame(two)])).toEqual([
        { type: 'attach', serial: 'aaaa1111' },
        { type: 'attach', serial: 'bbbb2222' },
      ]);
    });

    it('attaches the bare serial, not the length prefix glued to it', () => {
      expect(track(['0010' + '78f2af2a\tdevice\n'])).toEqual([{ type: 'attach', serial: '78f2af2a' }]);
    });

    it('handles a message split inside the prefix and inside the payload', () => {
      expect(track(['00', '1078f2', 'af2a\tdev', 'ice\n'])).toEqual([{ type: 'attach', serial: '78f2af2a' }]);
    });

    it('handles two messages in one chunk (attach then empty list detaches)', () => {
      expect(track(['0010' + '78f2af2a\tdevice\n' + '0000'])).toEqual([
        { type: 'attach', serial: '78f2af2a' },
        { type: 'detach', serial: '78f2af2a' },
      ]);
    });

    it('attaches every device in a multi-device message', () => {
      const payload = 'aaaa1111\tdevice\nbbbb2222\tdevice\n';
      expect(track([payload.length.toString(16).padStart(4, '0') + payload])).toEqual([
        { type: 'attach', serial: 'aaaa1111' },
        { type: 'attach', serial: 'bbbb2222' },
      ]);
    });

    it('detaches all previously seen devices on an empty list (0000)', () => {
      expect(track(['0010' + '78f2af2a\tdevice\n', '0000'])).toEqual([
        { type: 'attach', serial: '78f2af2a' },
        { type: 'detach', serial: '78f2af2a' },
      ]);
    });

    it('emits unauthorized (not attach) once per serial, then attach when it authorizes', () => {
      const f = (p: string) => p.length.toString(16).padStart(4, '0') + p;
      const u = '78f2af2a\tunauthorized\n';
      const d = '78f2af2a\tdevice\n';
      expect(track([f(u), f(u), f(d)])).toEqual([
        { type: 'unauthorized', serial: '78f2af2a' },
        { type: 'attach', serial: '78f2af2a' },
      ]);
    });

    it('re-emits unauthorized after the serial leaves and returns unauthorized', () => {
      const f = (p: string) => p.length.toString(16).padStart(4, '0') + p;
      const u = '78f2af2a\tunauthorized\n';
      expect(track([f(u), '0000', f(u)])).toEqual([
        { type: 'unauthorized', serial: '78f2af2a' },
        { type: 'detach', serial: '78f2af2a' },
        { type: 'unauthorized', serial: '78f2af2a' },
      ]);
    });

    it('detaches a serial that was only ever unauthorized when it disappears', () => {
      const u = '78f2af2a\tunauthorized\n';
      expect(track([u.length.toString(16).padStart(4, '0') + u, '0000'])).toEqual([
        { type: 'unauthorized', serial: '78f2af2a' },
        { type: 'detach', serial: '78f2af2a' },
      ]);
    });

    it('detaches an attached device that turns unauthorized', () => {
      const f = (p: string) => p.length.toString(16).padStart(4, '0') + p;
      expect(track([f('a\tdevice\n'), f('a\tunauthorized\n')])).toEqual([
        { type: 'attach', serial: 'a' },
        { type: 'detach', serial: 'a' },
        { type: 'unauthorized', serial: 'a' },
      ]);
    });
  });
});
