import { describe, it, expect } from 'vitest';
import { windowStats } from './windowStats.js';

describe('windowStats', () => {
  it('returns all-null stats for an empty window (never fabricate a 0)', () => {
    expect(windowStats([])).toEqual({ min: null, avg: null, peak: null });
  });

  it('computes min/avg/peak over a live rolling window', () => {
    expect(windowStats([10, 50, 90])).toEqual({ min: 10, avg: 50, peak: 90 });
  });

  it('rounds avg to the nearest whole percent', () => {
    expect(windowStats([10, 11, 12])).toEqual({ min: 10, avg: 11, peak: 12 });
  });

  it('handles a single-sample window (degenerate but honest)', () => {
    expect(windowStats([42])).toEqual({ min: 42, avg: 42, peak: 42 });
  });

  it('handles a flat window', () => {
    expect(windowStats([99, 99, 99, 99])).toEqual({ min: 99, avg: 99, peak: 99 });
  });
});
