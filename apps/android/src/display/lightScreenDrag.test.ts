import { describe, it, expect } from 'vitest';
import { computeDraggedBrightness } from './lightScreenDrag.js';

describe('computeDraggedBrightness', () => {
  it('increases brightness proportionally to a rightward drag across the track', () => {
    // Half the track width to the right, from 0.5 -> 1.0.
    expect(computeDraggedBrightness(0.5, 100, 200)).toBeCloseTo(1.0);
  });

  it('decreases brightness proportionally to a leftward drag', () => {
    expect(computeDraggedBrightness(0.5, -100, 200)).toBeCloseTo(0.0);
  });

  it('clamps at 1 when the drag overshoots the top of the track', () => {
    expect(computeDraggedBrightness(0.9, 500, 200)).toBe(1);
  });

  it('clamps at 0 when the drag overshoots the bottom of the track', () => {
    expect(computeDraggedBrightness(0.1, -500, 200)).toBe(0);
  });

  it('returns the drag-start brightness unchanged when the track has not been measured yet (width 0)', () => {
    // Before onLayout fires, sliderWidthRef.current is 0. Dividing dx by a
    // zero-width track must never propagate Infinity/NaN into brightness --
    // that would render an invalid background color and desync the slider
    // fill/knob until the next real drag.
    expect(computeDraggedBrightness(0.5, 40, 0)).toBe(0.5);
  });

  it('is a no-op for a zero-distance drag regardless of track width', () => {
    expect(computeDraggedBrightness(0.5, 0, 200)).toBe(0.5);
  });
});
