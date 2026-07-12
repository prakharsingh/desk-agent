import { describe, it, expect } from 'vitest';
import { pctOrZero, fmtPct, loadColor, formatBattery } from './systemFormat.js';

describe('pctOrZero', () => {
  it('passes through a numeric percentage', () => {
    expect(pctOrZero(42)).toBe(42);
  });

  it('passes through zero unchanged', () => {
    expect(pctOrZero(0)).toBe(0);
  });

  it('treats null as zero (no data yet, chart draws empty rather than crashing)', () => {
    expect(pctOrZero(null)).toBe(0);
  });
});

describe('fmtPct', () => {
  it('formats a numeric percentage rounded to the nearest whole number', () => {
    expect(fmtPct(41.6)).toBe('42%');
  });

  it('rounds down when the fraction is below the midpoint', () => {
    expect(fmtPct(41.4)).toBe('41%');
  });

  it('formats zero as 0%, not the null placeholder', () => {
    expect(fmtPct(0)).toBe('0%');
  });

  it('formats null as the honest em-dash placeholder, never a fake 0%', () => {
    expect(fmtPct(null)).toBe('—');
  });
});

describe('loadColor', () => {
  it('returns the base color for a normal load', () => {
    expect(loadColor(24, 'base', 'warn')).toBe('base');
  });

  it('returns the warn color at the 90% threshold (inclusive)', () => {
    expect(loadColor(90, 'base', 'warn')).toBe('warn');
  });

  it('returns the warn color above the threshold', () => {
    expect(loadColor(99, 'base', 'warn')).toBe('warn');
  });

  it('returns the base color just below the threshold', () => {
    expect(loadColor(89.9, 'base', 'warn')).toBe('base');
  });

  it('returns the base color for null (no data yet, not a fault)', () => {
    expect(loadColor(null, 'base', 'warn')).toBe('base');
  });
});

describe('formatBattery', () => {
  it('maps the N/A sentinel to an honest AC-power label', () => {
    expect(formatBattery('N/A')).toBe('AC · DOCKED');
  });

  it('maps the em-dash sentinel to an honest AC-power label', () => {
    expect(formatBattery('—')).toBe('AC · DOCKED');
  });

  it('passes a real battery percentage through unchanged', () => {
    expect(formatBattery('87%')).toBe('87%');
  });
});
