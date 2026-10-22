import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRealAdbRunner } from './adbRunner.js';

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

    it('does not attach an unauthorized device', () => {
      const payload = '78f2af2a\tunauthorized\n';
      expect(track([payload.length.toString(16).padStart(4, '0') + payload])).toEqual([]);
    });
  });
});
