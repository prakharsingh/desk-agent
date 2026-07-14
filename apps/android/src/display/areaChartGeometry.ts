// Gridline positions for the big axis-labeled AreaChart. Always 100/50/0%,
// regardless of the data -- these are the chart's fixed axis, not derived
// from the live window.
export function chartGridLines(height: number): { pct: number; y: number }[] {
  return [100, 50, 0].map((pct) => ({ pct, y: height - (pct / 100) * height }));
}

export interface AreaChartGeometry {
  linePoints: string;
  areaPoints: string;
  lastX: number;
  lastY: number;
}

// Point geometry for the System-detail AreaChart, over the live rolling
// window only (AppShell's ~40-sample history). Unlike the small home-screen
// Sparkline (auto-scaled to the window's own min/max, see sparkline.ts), this
// uses a FIXED 0-100% y-scale on purpose: the chart draws labeled 0/50/100%
// gridlines (see chartGridLines above), and an auto-scaled line under
// truthful axis labels would lie about where the value actually sits.
export function areaChartGeometry(history: number[], width: number, height: number): AreaChartGeometry {
  if (history.length === 0) {
    return { linePoints: '', areaPoints: '', lastX: 0, lastY: height };
  }

  const n = history.length;
  const coords = history.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * width;
    const clamped = Math.max(0, Math.min(100, v));
    const y = height - (clamped / 100) * height;
    return { x, y };
  });

  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  // Close the shape down to the 0% baseline (bottom-right, then bottom-left)
  // so the gradient fill below the line reads as an area, not just a stroke.
  const areaPoints = `${linePoints} ${width.toFixed(1)},${height.toFixed(1)} 0.0,${height.toFixed(1)}`;

  const last = coords[coords.length - 1]!;
  return { linePoints, areaPoints, lastX: last.x, lastY: last.y };
}
