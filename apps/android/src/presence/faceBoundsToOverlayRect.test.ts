import { describe, it, expect } from 'vitest';
import {
  faceBoundsToOverlayRect,
  faceBoundsToNormalizedBox,
  uprightFrameSize,
  orientationToRotationDegrees,
} from './faceBoundsToOverlayRect.js';

// OnePlus 6T front camera, as observed on-device (facebox-debug evidence):
// the analysis buffer stays landscape 1280x720, imageInfo.rotationDegrees is
// 270, MLKit returns face.bounds already rotated upright (portrait 720x1280),
// and the analysis buffer is NOT physically mirrored while the preview is.
const FRAME_6T = { frameWidth: 1280, frameHeight: 720, rotationDegrees: 270, mirrored: true };
// PresenceDetail's preview slot (dp). Contain-fit of an upright 720x1280
// image into 344x140: scale = min(344/720, 140/1280) = 0.109375 ->
// displayed 78.75 x 140, pillarboxed with offsetX = (344-78.75)/2 = 132.625.
const RECT = { width: 344, height: 140 };

describe('uprightFrameSize', () => {
  it('swaps width/height for 90 and 270 degree rotations', () => {
    expect(uprightFrameSize(1280, 720, 270)).toEqual({ width: 720, height: 1280 });
    expect(uprightFrameSize(1280, 720, 90)).toEqual({ width: 720, height: 1280 });
  });
  it('keeps the frame size for 0 and 180 degree rotations', () => {
    expect(uprightFrameSize(1280, 720, 0)).toEqual({ width: 1280, height: 720 });
    expect(uprightFrameSize(1280, 720, 180)).toEqual({ width: 1280, height: 720 });
  });
});

describe('orientationToRotationDegrees', () => {
  // Inverse of VisionCamera's CameraOrientation.fromDegrees (android
  // extensions/CameraOrientation+degrees.kt): 45..135 -> LEFT, 225..315 -> RIGHT.
  it('maps VisionCamera Frame.orientation back to imageInfo.rotationDegrees', () => {
    expect(orientationToRotationDegrees('up')).toBe(0);
    expect(orientationToRotationDegrees('left')).toBe(90);
    expect(orientationToRotationDegrees('down')).toBe(180);
    expect(orientationToRotationDegrees('right')).toBe(270);
  });
});

describe('faceBoundsToNormalizedBox', () => {
  it('normalizes against the upright size and mirrors X exactly once', () => {
    const box = faceBoundsToNormalizedBox({ x: 308, y: 591, width: 230, height: 230 }, FRAME_6T);
    expect(box.x).toBeCloseTo(182 / 720, 6); // 1 - 308/720 - 230/720
    expect(box.y).toBeCloseTo(591 / 1280, 6);
    expect(box.width).toBeCloseTo(230 / 720, 6);
    expect(box.height).toBeCloseTo(230 / 1280, 6);
  });
  it('does not mirror when the output is not mirrored', () => {
    const box = faceBoundsToNormalizedBox({ x: 308, y: 591, width: 230, height: 230 }, { ...FRAME_6T, mirrored: false });
    expect(box.x).toBeCloseTo(308 / 720, 6);
  });
});

describe('faceBoundsToOverlayRect', () => {
  it('maps the on-device 6T sample to the expected preview rect', () => {
    const r = faceBoundsToOverlayRect({ x: 308, y: 591, width: 230, height: 230 }, FRAME_6T, RECT);
    // left = 132.625 + (182/720)*78.75 = 152.53; top = (591/1280)*140 = 64.64
    // width = (230/720)*78.75 = 25.16;   height = (230/1280)*140 = 25.16
    expect(r.left).toBeCloseTo(152.53, 1);
    expect(r.top).toBeCloseTo(64.64, 1);
    expect(r.width).toBeCloseTo(25.16, 1);
    expect(r.height).toBeCloseTo(25.16, 1);
  });

  it('changing only bounds.y changes only top, never left (no axis swap)', () => {
    const a = faceBoundsToOverlayRect({ x: 308, y: 591, width: 230, height: 230 }, FRAME_6T, RECT);
    const b = faceBoundsToOverlayRect({ x: 308, y: 200, width: 230, height: 230 }, FRAME_6T, RECT);
    expect(b.left).toBeCloseTo(a.left, 6);
    expect(b.width).toBeCloseTo(a.width, 6);
    expect(b.height).toBeCloseTo(a.height, 6);
    expect(b.top).not.toBeCloseTo(a.top, 1);
    expect(b.top).toBeLessThan(a.top); // face moved up -> box moves up
  });

  it('changing only bounds.x changes only left, never top', () => {
    const a = faceBoundsToOverlayRect({ x: 308, y: 591, width: 230, height: 230 }, FRAME_6T, RECT);
    const b = faceBoundsToOverlayRect({ x: 100, y: 591, width: 230, height: 230 }, FRAME_6T, RECT);
    expect(b.top).toBeCloseTo(a.top, 6);
    // Mirrored selfie preview: smaller raw x -> further right on screen.
    expect(b.left).toBeGreaterThan(a.left);
  });

  it('a centred face lands at the horizontal centre of the shown image', () => {
    const r = faceBoundsToOverlayRect({ x: 245, y: 525, width: 230, height: 230 }, FRAME_6T, RECT);
    expect(r.left + r.width / 2).toBeCloseTo(RECT.width / 2, 6);
    expect(r.top + r.height / 2).toBeCloseTo(RECT.height / 2, 6);
  });
});
