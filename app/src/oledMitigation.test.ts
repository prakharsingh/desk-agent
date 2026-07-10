import { describe, it, expect } from 'vitest';
import { computePixelShiftOffset } from './oledMitigation.js';

describe('computePixelShiftOffset', () => {
  it('returns (0,0) at t=0', () => {
    expect(computePixelShiftOffset(0, 2, 60000)).toEqual({ x: 0, y: 0 });
  });

  it('stays within [-amplitude, amplitude] on both axes', () => {
    for (let t = 0; t < 120000; t += 1000) {
      const { x, y } = computePixelShiftOffset(t, 2, 60000);
      expect(Math.abs(x)).toBeLessThanOrEqual(2);
      expect(Math.abs(y)).toBeLessThanOrEqual(2);
    }
  });

  it('is periodic with the given periodMs', () => {
    const a = computePixelShiftOffset(1000, 2, 60000);
    const b = computePixelShiftOffset(1000 + 60000, 2, 60000);
    expect(a).toEqual(b);
  });
});
