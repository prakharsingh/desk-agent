import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CoreSupervisor, type CoreHealth } from './coreSupervisor.js';

class FakeChild extends EventEmitter {
  killed = false;
  posted: unknown[] = [];
  kill() {
    this.killed = true;
    return true;
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
}

describe('CoreSupervisor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeSupervisor(
    fork: (...args: any[]) => FakeChild,
    opts: Partial<{ maxRestarts: number; onMessage: (msg: any) => void }> = {},
  ) {
    const healthLog: CoreHealth[] = [];
    const supervisor = new CoreSupervisor({
      coreHostPath: '/fake/coreHost.js',
      configPath: '/fake/config.json',
      maxRestarts: opts.maxRestarts,
      onHealthChange: (h) => healthLog.push(h),
      onMessage: opts.onMessage,
      fork: fork as any,
    });
    return { supervisor, healthLog };
  }

  it('transitions starting -> running on spawn, and passes DESK_AGENT_CONFIG_PATH through env', () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const child = new FakeChild();
    const { supervisor, healthLog } = makeSupervisor((modulePath, args, opts) => {
      capturedEnv = opts.env;
      return child;
    });

    supervisor.start();
    expect(healthLog).toEqual(['starting']);
    child.emit('spawn');
    expect(healthLog).toEqual(['starting', 'running']);
    expect(capturedEnv?.DESK_AGENT_CONFIG_PATH).toBe('/fake/config.json');
  });

  it('merges extraEnv over process.env for the forked child (e.g. an augmented PATH from binaries.ts)', () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const child = new FakeChild();
    const supervisor = new CoreSupervisor({
      coreHostPath: '/fake/coreHost.js',
      configPath: '/fake/config.json',
      extraEnv: () => ({ PATH: '/opt/homebrew/bin:/usr/bin' }),
      fork: ((modulePath, args, opts) => {
        capturedEnv = opts.env;
        return child;
      }) as any,
    });
    supervisor.start();
    expect(capturedEnv?.PATH).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('recomputes extraEnv fresh on every spawn, not just once at construction (e.g. a binary installed after launch is picked up by the next restart)', () => {
    let callCount = 0;
    const capturedPaths: (string | undefined)[] = [];
    const supervisor = new CoreSupervisor({
      coreHostPath: '/fake/coreHost.js',
      configPath: '/fake/config.json',
      extraEnv: () => ({ PATH: `/candidate-${++callCount}` }),
      fork: ((modulePath: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
        capturedPaths.push(opts.env.PATH);
        return new FakeChild();
      }) as any,
    });

    supervisor.start();
    supervisor.restart();
    expect(capturedPaths).toEqual(['/candidate-1', '/candidate-2']);
  });

  it('does not restart after an intentional stop()', () => {
    const child = new FakeChild();
    const { supervisor, healthLog } = makeSupervisor(() => child);
    supervisor.start();
    child.emit('spawn');
    supervisor.stop();
    expect(healthLog.at(-1)).toBe('stopped');
    expect(child.killed).toBe(true);

    child.emit('exit', 1);
    vi.runAllTimers();
    // No new spawn attempted -- health stays 'stopped', not 'starting' again.
    expect(healthLog.at(-1)).toBe('stopped');
  });

  it('restarts with exponential backoff after an unexpected crash', () => {
    let spawnCount = 0;
    const children: FakeChild[] = [];
    const { supervisor, healthLog } = makeSupervisor(() => {
      spawnCount += 1;
      const c = new FakeChild();
      children.push(c);
      return c;
    });

    supervisor.start();
    children[0].emit('spawn');
    children[0].emit('exit', 1); // unexpected crash
    expect(healthLog.at(-1)).toBe('starting'); // about to retry

    vi.advanceTimersByTime(999);
    expect(spawnCount).toBe(1); // backoff not elapsed yet
    vi.advanceTimersByTime(1);
    expect(spawnCount).toBe(2); // 1000ms backoff elapsed, respawned
  });

  it('marks the core crashed after exceeding maxRestarts, and stops retrying', () => {
    let spawnCount = 0;
    const children: FakeChild[] = [];
    const { supervisor, healthLog } = makeSupervisor(() => {
      spawnCount += 1;
      const c = new FakeChild();
      children.push(c);
      return c;
    }, { maxRestarts: 2 });

    supervisor.start();
    for (let i = 0; i < 3; i++) {
      children[i].emit('spawn');
      children[i].emit('exit', 1);
      vi.runAllTimers();
    }

    expect(spawnCount).toBe(3); // initial + 2 restarts
    expect(healthLog.at(-1)).toBe('crashed');

    vi.runAllTimers();
    expect(spawnCount).toBe(3); // no further attempts
  });

  it('is immune to the killed child emitting a stale exit event after restart() has already moved on to a new child', () => {
    let spawnCount = 0;
    const children: FakeChild[] = [];
    const { supervisor, healthLog } = makeSupervisor(() => {
      spawnCount += 1;
      const c = new FakeChild();
      children.push(c);
      return c;
    });

    supervisor.start();
    children[0].emit('spawn');
    expect(healthLog.at(-1)).toBe('running');

    supervisor.restart(); // kills children[0] (kill() is fire-and-forget, not synchronous), spawns children[1]
    expect(spawnCount).toBe(2);
    children[1].emit('spawn');
    expect(healthLog.at(-1)).toBe('running');

    // The OLD child's 'exit' event arrives late, simulating the real async gap
    // between kill() and the OS actually delivering the exit -- by now
    // restart() has already reassigned this.child to the new, healthy child.
    children[0].emit('exit', 1);

    // The stale event must not clobber the new child's health or schedule a
    // spurious extra spawn.
    expect(healthLog.at(-1)).toBe('running');
    expect(spawnCount).toBe(2);

    vi.runAllTimers();
    expect(spawnCount).toBe(2);
  });

  it('restart() resets the restart counter and forces a fresh spawn', () => {
    let spawnCount = 0;
    const children: FakeChild[] = [];
    const { supervisor } = makeSupervisor(() => {
      spawnCount += 1;
      const c = new FakeChild();
      children.push(c);
      return c;
    }, { maxRestarts: 1 });

    supervisor.start();
    children[0].emit('spawn');
    children[0].emit('exit', 1);
    vi.runAllTimers();
    children[1].emit('spawn');
    children[1].emit('exit', 1);
    vi.runAllTimers();
    expect(spawnCount).toBe(2); // exhausted maxRestarts=1, now 'crashed'

    supervisor.restart();
    expect(spawnCount).toBe(3); // manual restart forces a new spawn regardless of prior exhaustion
  });

  describe('message channel (Phase 3: ControlChannel transport)', () => {
    it('forwards a "message" event from the child to onMessage', () => {
      const child = new FakeChild();
      const onMessage = vi.fn();
      const { supervisor } = makeSupervisor(() => child, { onMessage });
      supervisor.start();
      const snapshot = { kind: 'snapshot', data: { core: { uptimeMs: 0 } } };
      child.emit('message', snapshot);
      expect(onMessage).toHaveBeenCalledWith(snapshot);
    });

    it('sendToCore posts a message to the current child', () => {
      const child = new FakeChild();
      const { supervisor } = makeSupervisor(() => child);
      supervisor.start();
      supervisor.sendToCore({ kind: 'reissueTunnel' });
      expect(child.posted).toEqual([{ kind: 'reissueTunnel' }]);
    });

    it('sendToCore is a no-op (does not throw) when no child is currently running', () => {
      const { supervisor } = makeSupervisor(() => new FakeChild());
      expect(() => supervisor.sendToCore({ kind: 'reissueTunnel' })).not.toThrow();
    });

    it('does not forward a stale child\'s message after restart() has moved on', () => {
      let spawnCount = 0;
      const children: FakeChild[] = [];
      const onMessage = vi.fn();
      const { supervisor } = makeSupervisor(() => {
        spawnCount += 1;
        const c = new FakeChild();
        children.push(c);
        return c;
      }, { onMessage });

      supervisor.start();
      children[0].emit('spawn');
      supervisor.restart();
      children[1].emit('spawn');

      children[0].emit('message', { kind: 'log', entry: { message: 'stale' } });
      expect(onMessage).not.toHaveBeenCalled();

      children[1].emit('message', { kind: 'log', entry: { message: 'fresh' } });
      expect(onMessage).toHaveBeenCalledWith({ kind: 'log', entry: { message: 'fresh' } });
    });
  });
});
