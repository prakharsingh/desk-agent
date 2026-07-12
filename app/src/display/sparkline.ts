export function pushHistory(history: number[], value: number, maxLen: number): number[] {
  const next = [...history, value];
  return next.length > maxLen ? next.slice(next.length - maxLen) : next;
}

export function sparklinePoints(history: number[], width: number, height: number): { points: string; lastX: number; lastY: number } {
  if (history.length === 0) return { points: '', lastX: 0, lastY: height / 2 };
  const n = history.length;
  // Auto-scaled to this window's own min/max (standard sparkline convention)
  // rather than a fixed 0-100% range, so trend/shape stays visible regardless
  // of absolute magnitude, and two adjacent metrics of different magnitude
  // (e.g. CPU ~8%, RAM ~92%) don't land at opposite ends of their boxes.
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min;
  const coords = history.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * width;
    const y = range === 0 ? height / 2 : height - ((v - min) / range) * height;
    return { x, y };
  });
  const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1]!;
  return { points, lastX: last.x, lastY: last.y };
}
