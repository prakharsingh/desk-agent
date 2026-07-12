import { describe, it, expect } from 'vitest';
import { orientBBoxForPreview } from './orientBBoxForPreview.js';

describe('orientBBoxForPreview', () => {
  it('maps a full-frame box (0,0,1,1) onto itself', () => {
    const result = orientBBoxForPreview({ x: 0, y: 0, width: 1, height: 1 });
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.width).toBeCloseTo(1);
    expect(result.height).toBeCloseTo(1);
  });

  it('maps a box at the top-left corner to the bottom-right corner', () => {
    // x = 1 - 0 - 0.2 = 0.8, y = 1 - 0 - 0.2 = 0.8
    const result = orientBBoxForPreview({ x: 0, y: 0, width: 0.2, height: 0.2 });
    expect(result.x).toBeCloseTo(0.8);
    expect(result.y).toBeCloseTo(0.8);
    expect(result.width).toBeCloseTo(0.2);
    expect(result.height).toBeCloseTo(0.2);
  });

  it('swaps width and height for a non-square box', () => {
    const result = orientBBoxForPreview({ x: 0.1, y: 0.2, width: 0.3, height: 0.5 });
    expect(result.width).toBeCloseTo(0.5); // old height becomes new width
    expect(result.height).toBeCloseTo(0.3); // old width becomes new height
  });

  it('is an involution: applying it twice returns exactly to the original box', () => {
    // This transform is a rotation composed with a reflection (see doc
    // comment), not a pure 90-degree rotation -- a pure rotation would need
    // four applications to return to identity, but a reflection is its own
    // inverse and returns to identity after exactly two.
    const original = { x: 0.15, y: 0.3, width: 0.25, height: 0.1 };
    const twice = orientBBoxForPreview(orientBBoxForPreview(original));
    expect(twice.x).toBeCloseTo(original.x);
    expect(twice.y).toBeCloseTo(original.y);
    expect(twice.width).toBeCloseTo(original.width);
    expect(twice.height).toBeCloseTo(original.height);
  });

  it('matches the first on-device diagnostic capture used to derive this transform (OnePlus 6T, front camera)', () => {
    // Raw normalized bbox as captured from a real frame (naively dividing
    // MLKit's face.bounds by the raw 1280x720 landscape frame.width/height,
    // before any orientation correction).
    const rawNormalized = { x: 0.1875, y: 0.49444444444444446, width: 0.22890625, height: 0.40694444444444444 };
    const result = orientBBoxForPreview(rawNormalized);
    // Hand-derived expected values (see orientBBoxForPreview.ts's doc
    // comment for the full two-pass diagnosis trail).
    expect(result.x).toBeCloseTo(0.09861, 4);
    expect(result.y).toBeCloseTo(0.58359, 4);
    expect(result.width).toBeCloseTo(0.40694, 4);
    expect(result.height).toBeCloseTo(0.22891, 4);
  });

  it('matches the second on-device diagnostic capture that confirmed the reflection (OnePlus 6T, front camera)', () => {
    // A second, independent capture -- confirmed the box landed on the
    // face's lower/chin area rather than in the blank wall above the head
    // (where the pure-rotation-only version had placed it).
    const rawNormalized = { x: 0.221875, y: 0.8291666666666667, width: 0.1296875, height: 0.23055555555555557 };
    const result = orientBBoxForPreview(rawNormalized);
    expect(result.x).toBeCloseTo(-0.05972, 4); // negative: clamped by mapBoxToPreview downstream
    expect(result.y).toBeCloseTo(0.64844, 4);
    expect(result.width).toBeCloseTo(0.23056, 4);
    expect(result.height).toBeCloseTo(0.12969, 4);
  });
});
