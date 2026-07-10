import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WorkerHost } from './index.js';
import type { PluginSpec, WorkerLike } from './index.js';

class FakeWorker extends EventEmitter implements WorkerLike {
  terminated = false;
  postMessage = vi.fn();
  async terminate() {
    this.terminated = true;
    this.emit('exit', 1);
    return 1;
  }
}

function makeSpec(overrides: Partial<PluginSpec> = {}): PluginSpec {
  return { id: 'system-stats', modulePath: '/fake/system-stats.js', permissions: ['sys:read-stats'], ...overrides };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WorkerHost', () => {
  it('marks a plugin running once its worker reports ready', async () => {
    let fake!: FakeWorker;
    const host = new WorkerHost([makeSpec()], {
      maxOldGenerationSizeMb: 64,
      maxRestarts: 5,
      callTimeoutMs: 1000,
      onLog: vi.fn(),
      onEventPublish: vi.fn(),
      onWidgetPublish: vi.fn(),
      createWorker: () => { fake = new FakeWorker(); return fake; },
    });
    await host.start();
    fake.emit('message', { kind: 'ready' });
    expect(host.getStatus('system-stats')).toBe('running');
  });

  it('resolves getWidgets from a running worker response', async () => {
    let fake!: FakeWorker;
    const host = new WorkerHost([makeSpec()], {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 1000,
      onLog: vi.fn(), onEventPublish: vi.fn(), onWidgetPublish: vi.fn(),
      createWorker: () => { fake = new FakeWorker(); return fake; },
    });
    await host.start();
    fake.emit('message', { kind: 'ready' });
    const pending = host.getWidgets('system-stats');
    const requestId = (fake.postMessage.mock.calls[0][0] as any).requestId;
    fake.emit('message', { kind: 'getWidgetsResult', requestId, widgets: [{ type: 'system-stats', props: { cpu: 5 } }] });
    await expect(pending).resolves.toEqual([{ type: 'system-stats', props: { cpu: 5 } }]);
  });

  it('restarts a crashed worker with exponential backoff, then marks it failed after maxRestarts', async () => {
    const onLog = vi.fn();
    let spawnCount = 0;
    const host = new WorkerHost([makeSpec()], {
      maxOldGenerationSizeMb: 64, maxRestarts: 2, callTimeoutMs: 1000,
      onLog, onEventPublish: vi.fn(), onWidgetPublish: vi.fn(),
      createWorker: () => { spawnCount++; const w = new FakeWorker(); queueMicrotask(() => { w.emit('error', new Error('boom')); w.emit('exit', 1); }); return w; },
    });
    await host.start();
    await vi.advanceTimersByTimeAsync(1000);  // 1st backoff
    await vi.advanceTimersByTimeAsync(2000);  // 2nd backoff
    await vi.advanceTimersByTimeAsync(4000);  // exceeds maxRestarts
    expect(host.getStatus('system-stats')).toBe('failed');
    expect(spawnCount).toBe(3); // initial + 2 restarts
  });

  it('counts a real-style crash (error then exit) as exactly one crash, not two', async () => {
    const onLog = vi.fn();
    let spawnCount = 0;
    const host = new WorkerHost([makeSpec()], {
      maxOldGenerationSizeMb: 64, maxRestarts: 2, callTimeoutMs: 1000,
      onLog, onEventPublish: vi.fn(), onWidgetPublish: vi.fn(),
      createWorker: () => {
        spawnCount++;
        const w = new FakeWorker();
        // Mimic real node:worker_threads behavior: an uncaught exception emits
        // 'error' with the exception, followed immediately by 'exit' with a
        // non-zero code -- both for the SAME crash.
        queueMicrotask(() => {
          w.emit('error', new Error('boom'));
          w.emit('exit', 1);
        });
        return w;
      },
    });
    await host.start();
    // With correct single-counting, each real crash (error+exit pair) increments
    // the restart count by exactly 1: crash1 -> count=1 (backoff 1000ms),
    // crash2 -> count=2 (backoff 2000ms), crash3 -> count=3 > maxRestarts(2) ->
    // 'failed'. So after only the 1st backoff, exactly 1 restart has happened
    // and the plugin is not yet failed; only after the 2nd backoff (which
    // triggers the 3rd crash) does it reach 'failed'. Double-counting (error
    // and exit each independently calling handleCrash) would instead bump the
    // count by 2 per real crash, reaching 'failed' one full cycle early --
    // right after the 1st backoff instead of after the 2nd.
    await vi.advanceTimersByTimeAsync(1000);  // 1st backoff
    expect(host.getStatus('system-stats')).not.toBe('failed');
    expect(spawnCount).toBe(2); // initial + exactly 1 restart so far
    await vi.advanceTimersByTimeAsync(2000);  // 2nd backoff
    expect(host.getStatus('system-stats')).toBe('failed');
    expect(spawnCount).toBe(3); // initial + exactly 2 restarts -- no extra spawn from double-counting
  });

  it('terminates and marks a plugin degraded when a call exceeds its deadline (hang)', async () => {
    let fake!: FakeWorker;
    const host = new WorkerHost([makeSpec()], {
      maxOldGenerationSizeMb: 64, maxRestarts: 5, callTimeoutMs: 500,
      onLog: vi.fn(), onEventPublish: vi.fn(), onWidgetPublish: vi.fn(),
      createWorker: () => { fake = new FakeWorker(); return fake; },
    });
    await host.start();
    fake.emit('message', { kind: 'ready' });
    const pending = host.getWidgets('system-stats'); // fake never responds: simulated hang
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual([]);
    expect(host.getStatus('system-stats')).toBe('degraded');
    expect(fake.terminated).toBe(true);
  });
});
