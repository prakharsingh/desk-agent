export function pctOrZero(v: number | null): number {
  return typeof v === 'number' ? v : 0;
}

export function fmtPct(v: number | null): string {
  return typeof v === 'number' ? `${Math.round(v)}%` : '—';
}
