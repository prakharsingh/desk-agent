import { describe, it, expect } from 'vitest';
import { fahrenheitToCelsius, formatTemp } from './temperature.js';

describe('fahrenheitToCelsius', () => {
  it('converts freezing and boiling reference points exactly', () => {
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(fahrenheitToCelsius(212)).toBe(100);
  });
  it('converts a mid-range value exactly', () => {
    expect(fahrenheitToCelsius(68)).toBe(20);
  });
});

describe('formatTemp', () => {
  it('formats in Fahrenheit for unit "F"', () => {
    expect(formatTemp(68, 'F')).toBe('68°F');
  });
  it('formats in Celsius for unit "C", rounding to the nearest degree', () => {
    expect(formatTemp(68, 'C')).toBe('20°C');
    expect(formatTemp(70, 'C')).toBe('21°C');
  });
});
