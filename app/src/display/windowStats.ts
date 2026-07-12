export interface WindowStats {
  min: number | null;
  avg: number | null;
  peak: number | null;
}

// MIN / AVG / PEAK over the visible live rolling window (the ~40-sample
// history AppShell already keeps), never over any persisted long-range
// history the app doesn't have. Callers must label this "LIVE WINDOW" (or
// similar), never a time range like "24H" -- that would imply data this
// function was never given. An empty window is honestly null, not a
// fabricated 0.
export function windowStats(history: number[]): WindowStats {
  if (history.length === 0) return { min: null, avg: null, peak: null };

  const min = Math.min(...history);
  const peak = Math.max(...history);
  const avg = Math.round(history.reduce((sum, v) => sum + v, 0) / history.length);

  return { min, avg, peak };
}
