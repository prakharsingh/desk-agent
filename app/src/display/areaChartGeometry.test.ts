import { describe, it, expect } from 'vitest';
import { areaChartGeometry, chartGridLines } from './areaChartGeometry.js';

describe('chartGridLines', () => {
  it('places 100/50/0 gridlines at top/mid/bottom regardless of data', () => {
    expect(chartGridLines(100)).toEqual([
      { pct: 100, y: 0 },
      { pct: 50, y: 50 },
      { pct: 0, y: 100 },
    ]);
  });
});

describe('areaChartGeometry', () => {
  it('returns empty geometry for an empty window (never fabricate a shape)', () => {
    const g = areaChartGeometry([], 100, 40);
    expect(g.linePoints).toBe('');
    expect(g.areaPoints).toBe('');
    expect(g.lastX).toBe(0);
    expect(g.lastY).toBe(40);
  });

  it('places a single sample at x=0, on the fixed 0-100% y-scale', () => {
    const g = areaChartGeometry([50], 100, 40);
    expect(g.linePoints).toBe('0.0,20.0');
    expect(g.lastX).toBe(0);
    expect(g.lastY).toBe(20);
  });

  it('uses a fixed 0-100% y-scale (not auto-scaled to the window like the small sparkline)', () => {
    const g = areaChartGeometry([0, 50, 100], 100, 50);
    expect(g.linePoints).toBe('0.0,50.0 50.0,25.0 100.0,0.0');
    expect(g.lastX).toBe(100);
    expect(g.lastY).toBe(0);
  });

  it('closes the area polygon down to the 0% baseline for the gradient fill', () => {
    const g = areaChartGeometry([0, 50, 100], 100, 50);
    expect(g.areaPoints).toBe('0.0,50.0 50.0,25.0 100.0,0.0 100.0,50.0 0.0,50.0');
  });

  it('clamps out-of-range values defensively rather than drawing off-chart', () => {
    const g = areaChartGeometry([150, -20], 10, 10);
    expect(g.linePoints).toBe('0.0,0.0 10.0,10.0');
  });
});
