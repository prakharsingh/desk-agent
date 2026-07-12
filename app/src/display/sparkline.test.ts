import { describe, it, expect } from 'vitest';
import { pushHistory, sparklinePoints } from './sparkline.js';

describe('pushHistory', () => {
  it('appends and caps at maxLen, dropping the oldest', () => {
    const h = pushHistory([1, 2, 3], 4, 3);
    expect(h).toEqual([2, 3, 4]);
  });
  it('grows until maxLen is reached', () => {
    expect(pushHistory([1, 2], 3, 5)).toEqual([1, 2, 3]);
  });
});

describe('sparklinePoints', () => {
  // Auto-scaled to the visible window's own min/max (standard sparkline
  // convention) rather than a fixed 0-100% range. A fixed range squashes any
  // series that doesn't span the full range into a sliver near one edge, and
  // makes two adjacent metrics of different absolute magnitude (e.g. CPU ~8%,
  // RAM ~92%) land at opposite ends of their boxes, reading as "misaligned"
  // even though each is individually correct.
  it('maps the min of the window to the bottom edge and the max to the top edge', () => {
    const { points } = sparklinePoints([10, 30, 20], 100, 100);
    expect(points).toBe('0.0,100.0 50.0,0.0 100.0,50.0');
  });
  it('centers a flat history at mid-height rather than pinning it to an edge', () => {
    const { points } = sparklinePoints([42, 42, 42], 100, 100);
    expect(points).toBe('0.0,50.0 50.0,50.0 100.0,50.0');
  });
  it('reports the last point coordinates separately', () => {
    const { lastX, lastY } = sparklinePoints([0, 100], 100, 100);
    expect(lastX).toBe(100);
    expect(lastY).toBe(0);
  });
  it('handles a single-point history without dividing by zero', () => {
    const { points, lastX, lastY } = sparklinePoints([50], 100, 100);
    expect(points).toBe('0.0,50.0');
    expect(lastX).toBe(0);
    expect(lastY).toBe(50);
  });
  it('handles an empty history', () => {
    expect(sparklinePoints([], 100, 100)).toEqual({ points: '', lastX: 0, lastY: 50 });
  });
});
