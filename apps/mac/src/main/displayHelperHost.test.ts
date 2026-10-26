import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DisplayHelperHost, type HelperChildLike } from './displayHelperHost.js';
import type { HelperEvent, HelperStartCommand } from './displayHelperProtocol.js';

class FakeChild extends EventEmitter implements HelperChildLike {
  pid = 4242;
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_sig?: NodeJS.Signals) => true);
  stdinText = '';
  constructor() {
    super();
    this.stdin.on('data', (c: Buffer) => (this.stdinText += c.toString()));
  }
}

const START: HelperStartCommand = {
  cmd: 'start', sessionId: 'sess-1', token: 'SECRET-TOKEN', port: 8788, surfaceW: 2400, surfaceH: 1080,
  orientation: 'landscape', serialNum: 99, vendorId: 0x3456, productId: 0x4d44,
};

describe('DisplayHelperHost', () => {
  let dir: string;
  let pidfilePath: string;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-dhh-'));
    pidfilePath = path.join(dir, 'display-helper.pid');
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup(extra: Partial<ConstructorParameters<typeof DisplayHelperHost>[0]> = {}) {
    const child = new FakeChild();
    const events: HelperEvent[] = [];
    const exits: Array<{ reason: string; code: number | null; signal: NodeJS.Signals | null; error?: string }> = [];
    const stderr: string[] = [];
    const spawn = vi.fn((_cmd: string, _args: string[]) => child);
    const host = new DisplayHelperHost({
      helperPath: '/x/desk-agent-display-helper', pidfilePath,
      onEvent: (e) => events.push(e), onExit: (i) => exits.push(i), onStderr: (t) => stderr.push(t),
      spawn, ...extra,
    });
    return { child, events, exits, stderr, spawn, host };
  }

  it('passes the token on stdin, never in argv', () => {
    const { child, spawn, host } = setup();
    host.start(START);
    expect(spawn).toHaveBeenCalledWith('/x/desk-agent-display-helper', ['serve']);
    const firstLine = child.stdinText.split('\n')[0]!;
    expect(JSON.parse(firstLine)).toEqual(START);
    expect(JSON.stringify(spawn.mock.calls)).not.toContain('SECRET-TOKEN');
    expect(host.isRunning()).toBe(true);
  });

  it('throws if started twice while running', () => {
    const { host } = setup();
    host.start(START);
    expect(() => host.start(START)).toThrow();
  });

  it('forwards stdout events even when lines arrive split', () => {
    const { child, events, host } = setup();
    host.start(START);
    child.stdout.write('{"evt":"ready","displayId":3,');
    child.stdout.write('"port":8788}\n{"evt":"conn');
    expect(events).toEqual([{ evt: 'ready', displayId: 3, port: 8788 }]);
    child.stdout.write('ected"}\n\ngarbage\n');
    expect(events).toEqual([{ evt: 'ready', displayId: 3, port: 8788 }, { evt: 'connected' }]);
  });

  it('forwards stderr text', () => {
    const { child, stderr, host } = setup();
    host.start(START);
    child.stderr.write('diag line\n');
    expect(stderr.join('')).toBe('diag line\n');
  });

  it("reports the helper's own ended reason on exit", () => {
    const { child, exits, host } = setup();
    host.start(START);
    child.stdout.write('{"evt":"ended","reason":"watchdog"}\n');
    child.emit('exit', 0, null);
    expect(exits).toEqual([{ reason: 'watchdog', code: 0, signal: null }]);
    expect(host.isRunning()).toBe(false);
  });

  it('flushes an unterminated final ended line on exit', () => {
    const { child, exits, host } = setup();
    host.start(START);
    child.stdout.write('{"evt":"ended","reason":"phone-bye"}');
    child.emit('exit', 0, null);
    expect(exits[0]!.reason).toBe('phone-bye');
  });

  it('reports helper-crashed when the helper exits without ended', () => {
    const { child, exits, host } = setup();
    host.start(START);
    child.emit('exit', null, 'SIGSEGV');
    expect(exits).toEqual([{ reason: 'helper-crashed', code: null, signal: 'SIGSEGV' }]);
  });

  it('a spawn error (no pid) is reported once as helper-crashed with its message and clears the running state', () => {
    const { child, exits, host } = setup();
    child.pid = undefined as unknown as number;
    host.start(START);
    child.emit('error', new Error('spawn /x ENOENT'));
    child.emit('exit', null, null);
    expect(exits).toHaveLength(1);
    expect(exits[0]!.reason).toBe('helper-crashed');
    expect(exits[0]!.error).toBe('spawn /x ENOENT');
    expect(host.isRunning()).toBe(false);
    expect(fs.existsSync(pidfilePath)).toBe(false);
  });

  it('a later error on a spawned child (e.g. failed kill) does not end ownership', () => {
    const { child, exits, stderr, host } = setup();
    host.start(START);
    child.emit('error', new Error('kill EPERM'));
    expect(exits).toHaveLength(0);
    expect(host.isRunning()).toBe(true);
    expect(fs.existsSync(pidfilePath)).toBe(true);
    expect(stderr.join('')).toContain('kill EPERM');
    child.emit('exit', 0, null);
    expect(exits).toHaveLength(1);
  });

  it('decodes multi-byte UTF-8 split across chunks', () => {
    const { child, events, host } = setup();
    host.start(START);
    const bytes = Buffer.from('{"evt":"log","level":"info","message":"a\u2026b"}\n', 'utf8');
    const cut = bytes.indexOf(0xe2) + 1;
    child.stdout.write(bytes.subarray(0, cut));
    child.stdout.write(bytes.subarray(cut));
    expect(events).toEqual([{ evt: 'log', level: 'info', message: 'a\u2026b' }]);
  });

  it('a throwing onEvent consumer does not escape and is logged to onStderr', () => {
    const { child, stderr, exits, host } = setup({ onEvent: () => { throw new Error('boom'); } });
    host.start(START);
    expect(() => child.stdout.write('{"evt":"connected"}\n')).not.toThrow();
    expect(stderr.join('')).toContain('boom');
    child.emit('exit', 0, null);
    expect(exits).toHaveLength(1);
  });

  it('real-process smoke: default spawn path reports the unterminated ended line exactly once', async () => {
    vi.useRealTimers();
    const script = path.join(dir, 'fake-helper.sh');
    fs.writeFileSync(script, '#!/bin/sh\nprintf \'{"evt":"ended","reason":"watchdog"}\'\n', { mode: 0o755 });
    const exits: Array<{ reason: string }> = [];
    const host = new DisplayHelperHost({ helperPath: script, pidfilePath, onEvent: () => {}, onExit: (i) => exits.push(i) });
    host.start(START);
    await vi.waitFor(() => expect(exits).toHaveLength(1), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(exits).toEqual([expect.objectContaining({ reason: 'watchdog', code: 0 })]);
    expect(host.isRunning()).toBe(false);
  });

  it('reports onSpawn once the child has actually spawned, never for a spawn error', () => {
    const onSpawn = vi.fn();
    const ok = setup({ onSpawn });
    ok.host.start(START);
    expect(onSpawn).not.toHaveBeenCalled();
    ok.child.emit('spawn');
    expect(onSpawn).toHaveBeenCalledTimes(1);

    const failedSpawn = vi.fn();
    const bad = setup({ onSpawn: failedSpawn });
    bad.child.pid = undefined as unknown as number;
    bad.host.start(START);
    bad.child.emit('error', new Error('spawn /x ENOENT'));
    expect(failedSpawn).not.toHaveBeenCalled();
    expect(bad.exits).toHaveLength(1);
  });

  it('real-process: onSpawn fires for an executable helper and not for a missing one', async () => {
    vi.useRealTimers();
    const script = path.join(dir, 'fake-helper-spawn.sh');
    fs.writeFileSync(script, '#!/bin/sh\nprintf \'{"evt":"ended","reason":"watchdog"}\\n\'\n', { mode: 0o755 });
    const spawned = vi.fn();
    const exits: Array<{ reason: string; error?: string }> = [];
    new DisplayHelperHost({ helperPath: script, pidfilePath, onEvent: () => {}, onExit: (i) => exits.push(i), onSpawn: spawned }).start(START);
    await vi.waitFor(() => expect(exits).toHaveLength(1), { timeout: 5000 });
    expect(spawned).toHaveBeenCalledTimes(1);

    const missingSpawned = vi.fn();
    const missingExits: Array<{ reason: string; error?: string }> = [];
    new DisplayHelperHost({
      helperPath: path.join(dir, 'missing', 'desk-agent-display-helper'), pidfilePath,
      onEvent: () => {}, onExit: (i) => missingExits.push(i), onSpawn: missingSpawned,
    }).start(START);
    await vi.waitFor(() => expect(missingExits).toHaveLength(1), { timeout: 5000 });
    expect(missingSpawned).not.toHaveBeenCalled();
    expect(missingExits[0]!.error).toContain('ENOENT');
  });

  it('can start again after exit', () => {
    const { child, host } = setup();
    host.start(START);
    child.emit('exit', 0, null);
    expect(() => host.start(START)).not.toThrow();
  });

  it('stop writes stop, ends stdin, then escalates to SIGTERM at 2s and SIGKILL at 4s', () => {
    const { child, host } = setup();
    host.start(START);
    host.stop();
    expect(child.stdinText.split('\n').filter(Boolean).map((l) => JSON.parse(l).cmd)).toEqual(['start', 'stop']);
    expect(child.stdin.writableEnded).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith('SIGTERM');
    vi.advanceTimersByTime(1999);
    expect(child.kill).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
  });

  it('a clean exit during stop cancels the escalation timers', () => {
    const { child, host } = setup();
    host.start(START);
    host.stop();
    child.emit('exit', 0, null);
    vi.advanceTimersByTime(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stop is a no-op when idle and idempotent while stopping', () => {
    const { child, host } = setup();
    expect(() => host.stop()).not.toThrow();
    host.start(START);
    host.stop();
    host.stop();
    expect(child.stdinText.match(/"stop"/g)).toHaveLength(1);
  });

  it('stop survives a broken stdin pipe', () => {
    const { child, host } = setup();
    host.start(START);
    child.stdin.destroy();
    expect(() => host.stop()).not.toThrow();
    child.stdin.emit('error', new Error('EPIPE'));
  });

  it('writes the pidfile on spawn and removes it on exit', () => {
    const { child, host } = setup();
    host.start(START);
    expect(fs.readFileSync(pidfilePath, 'utf8').trim()).toBe('4242');
    child.emit('exit', 0, null);
    expect(fs.existsSync(pidfilePath)).toBe(false);
  });

  describe('killStale', () => {
    it('only kills a process that is really the helper', () => {
      fs.writeFileSync(pidfilePath, '777\n');
      const killPid = vi.fn();
      const { host } = setup({ processName: () => 'zsh', killPid });
      host.killStale();
      expect(killPid).not.toHaveBeenCalled();
      expect(fs.existsSync(pidfilePath)).toBe(false);
    });

    it('does nothing while this host owns a live child', () => {
      const killPid = vi.fn();
      const { host } = setup({ processName: () => 'desk-agent-display-helper', killPid });
      host.start(START);
      host.killStale();
      expect(killPid).not.toHaveBeenCalled();
      expect(fs.readFileSync(pidfilePath, 'utf8').trim()).toBe('4242');
    });

    it('kills a stale helper (path ending in desk-agent-display-helper) and removes the pidfile', () => {
      fs.writeFileSync(pidfilePath, '777\n');
      const killPid = vi.fn();
      const { host } = setup({ processName: () => '/Applications/Desk Agent.app/Contents/MacOS/desk-agent-display-helper', killPid });
      host.killStale();
      expect(killPid).toHaveBeenCalledWith(777, 'SIGTERM');
      expect(fs.existsSync(pidfilePath)).toBe(false);
    });

    it('escalates to SIGKILL if the stale helper is still the helper after 2s', () => {
      fs.writeFileSync(pidfilePath, '777\n');
      const killPid = vi.fn();
      const { host } = setup({ processName: () => 'desk-agent-display-helper', killPid });
      host.killStale();
      vi.advanceTimersByTime(2000);
      expect(killPid).toHaveBeenLastCalledWith(777, 'SIGKILL');
    });

    it('tolerates a missing, empty or garbage pidfile and a dead pid', () => {
      const killPid = vi.fn();
      const { host } = setup({ processName: () => null, killPid });
      expect(() => host.killStale()).not.toThrow();
      fs.writeFileSync(pidfilePath, 'garbage');
      expect(() => host.killStale()).not.toThrow();
      expect(fs.existsSync(pidfilePath)).toBe(false);
      fs.writeFileSync(pidfilePath, '888');
      host.killStale();
      expect(killPid).not.toHaveBeenCalled();
    });
  });
});
