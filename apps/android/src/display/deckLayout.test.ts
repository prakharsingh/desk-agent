import { describe, it, expect } from 'vitest';
import { computeDeckGrid } from './deckLayout.js';

describe('computeDeckGrid', () => {
  it('honors an explicitly configured grid verbatim', () => {
    expect(computeDeckGrid(402, 9, { rows: 5, cols: 4 })).toEqual({ rows: 5, cols: 4 });
  });

  it('derives columns from width at >=128dp per button, min 2', () => {
    expect(computeDeckGrid(402, 9)).toEqual({ rows: 3, cols: 3 });
    expect(computeDeckGrid(240, 4)).toEqual({ rows: 2, cols: 2 }); // 240/128 -> 1, clamped to 2
    expect(computeDeckGrid(800, 9)).toEqual({ rows: 2, cols: 5 }); // 800/128 -> 6, capped at 5
  });

  it('rows grow to fit all buttons', () => {
    expect(computeDeckGrid(402, 10)).toEqual({ rows: 4, cols: 3 });
    expect(computeDeckGrid(402, 0)).toEqual({ rows: 0, cols: 3 });
  });
});
