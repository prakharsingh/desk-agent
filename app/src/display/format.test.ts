import { describe, it, expect } from 'vitest';
import { formatClock, formatDate, formatUptime, formatAway, formatForecastDay } from './format.js';

describe('formatClock', () => {
  it('pads hours/minutes/seconds to 2 digits', () => {
    const t = new Date(2026, 6, 11, 9, 5, 3).getTime();
    expect(formatClock(t)).toEqual({ timeHHMM: '09:05', timeSS: '03' });
  });
});

describe('formatDate', () => {
  it('formats as "DOW DD MON YYYY"', () => {
    const t = new Date(2026, 6, 11, 9, 5, 3).getTime(); // Sat Jul 11 2026
    expect(formatDate(t)).toBe('SAT 11 JUL 2026');
  });
});

describe('formatUptime', () => {
  it('formats elapsed ms as HH:MM:SS', () => {
    const startedAt = 0;
    const now = (2 * 3600 + 3 * 60 + 4) * 1000; // 02:03:04
    expect(formatUptime(startedAt, now)).toBe('02:03:04');
  });
});

describe('formatAway', () => {
  it('formats under a minute as "Ns"', () => {
    expect(formatAway(45_000)).toBe('45s');
  });
  it('formats a minute or more as "Mm SSs"', () => {
    expect(formatAway(65_000)).toBe('1m 05s');
  });
});

describe('formatForecastDay', () => {
  it('formats an ISO date string as a 3-letter weekday, independent of local timezone', () => {
    expect(formatForecastDay('2026-07-12')).toBe('SUN');
    expect(formatForecastDay('2026-07-13')).toBe('MON');
    expect(formatForecastDay('2026-07-18')).toBe('SAT');
  });
});
