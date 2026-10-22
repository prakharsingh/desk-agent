import { describe, expect, it } from 'vitest';
import type { StatusSnapshot } from '@desk-agent/core';
import { SnapshotCache } from './snapshotCache.js';

const snapshot = { clients: { connected: 1, lastHelloAt: null } } as unknown as StatusSnapshot;

describe('SnapshotCache', () => {
  it('holds the latest snapshot while the core is running', () => {
    const cache = new SnapshotCache();
    cache.set(snapshot);
    expect(cache.onHealthChange('running')).toBe(false);
    expect(cache.get()).toBe(snapshot);
  });

  it.each(['crashed', 'starting', 'stopped'] as const)(
    'clears a stale snapshot when the core goes %s, reporting that it did',
    (health) => {
      const cache = new SnapshotCache();
      cache.set(snapshot);
      expect(cache.onHealthChange(health)).toBe(true);
      expect(cache.get()).toBeNull();
    },
  );

  it('does not report a clear when there was nothing to clear', () => {
    const cache = new SnapshotCache();
    expect(cache.onHealthChange('stopped')).toBe(false);
    expect(cache.get()).toBeNull();
  });
});
