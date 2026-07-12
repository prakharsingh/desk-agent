import { describe, it, expect } from 'vitest';
import { pctOrZero, fmtPct } from './systemFormat.js';

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
