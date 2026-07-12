export function pctOrZero(v: number | null): number {
  return typeof v === 'number' ? v : 0;
}

export function fmtPct(v: number | null): string {
  return typeof v === 'number' ? `${Math.round(v)}%` : '—';
}

// Threshold colour for a load metric. A high sustained value should read as an
// intentional "running hot" state, not as the same neutral colour as an idle
// one (which made RAM at ~99% look either broken or falsely benign). Amber
// (warn) rather than red is used on purpose: elevated utilisation is a normal
// steady state on macOS, not a fault, so it should register as "high" without
// crying wolf. Pass theme.colors.warn as `warn` at the call site.
export function loadColor(pct: number | null, base: string, warn: string): string {
  return typeof pct === 'number' && pct >= 90 ? warn : base;
}

// Docked-phone battery display. The wire reports "N/A" (and "—" when absent)
// for a phone that is permanently powered over the dock; surfacing that raw
// reads like a sensor failure. Map those sentinels to an honest power-source
// label instead. Any real percentage string passes through untouched.
export function formatBattery(battery: string): string {
  return battery === 'N/A' || battery === '—' ? 'AC · DOCKED' : battery;
}
