import { describe, it, expect } from 'vitest';
import { mapBoxToPreview, analysisCropInPreview } from './mapBoxToPreview.js';

// A frameSize whose aspect ratio matches rect exactly means resizeMode="contain"
// fills the whole rect (scale=1, no letterbox offset) -- this reduces to the
// pre-letterbox-aware behavior, so these fixture pairs preserve every existing
// expected value below.
const FILL_RECT_200 = { width: 200, height: 200 };
const FILL_FRAME_200 = { width: 200, height: 200 };
const FILL_RECT_100 = { width: 100, height: 100 };
const FILL_FRAME_100 = { width: 100, height: 100 };

describe('mapBoxToPreview', () => {
  it('maps a centered normalized box to a centered preview rect', () => {
    const bbox = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const result = mapBoxToPreview(bbox, FILL_RECT_200, FILL_FRAME_200);
    // No mirror: left = x * rect.width = 0.25 * 200 = 50
    expect(result.left).toBe(50);
    expect(result.top).toBe(50);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it('maps a box at the top-left corner (0,0)', () => {
    const bbox = { x: 0, y: 0, width: 0.2, height: 0.2 };
    const result = mapBoxToPreview(bbox, FILL_RECT_100, FILL_FRAME_100);
    // No mirror: left = 0 * 100 = 0, top = 0 * 100 = 0
    expect(result.left).toBe(0);
    expect(result.top).toBe(0);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it('maps a box near the bottom-right corner (1,1)', () => {
    const bbox = { x: 0.8, y: 0.8, width: 0.2, height: 0.2 };
    const result = mapBoxToPreview(bbox, FILL_RECT_100, FILL_FRAME_100);
    // No mirror: left = 0.8 * 100 = 80, top = 0.8 * 100 = 80
    expect(result.left).toBeCloseTo(80);
    expect(result.top).toBeCloseTo(80);
    expect(result.width).toBeCloseTo(20);
    expect(result.height).toBeCloseTo(20);
  });

  it('does not mirror the X coordinate: a box at the left edge of the frame stays at the left edge of the preview', () => {
    // Mirroring is applied once upstream (faceBoundsToOverlayRect.ts), so
    // this function must NOT re-mirror.
    const bbox = { x: 0, y: 0.5, width: 0.1, height: 0.1 };
    const result = mapBoxToPreview(bbox, FILL_RECT_200, FILL_FRAME_200);
    // left = 0 * 200 = 0
    expect(result.left).toBe(0);
    expect(result.width).toBe(20);
  });

  it('does not mirror the X coordinate: a box at the right edge of the frame stays at the right edge of the preview', () => {
    const bbox = { x: 0.9, y: 0.5, width: 0.1, height: 0.1 };
    const result = mapBoxToPreview(bbox, FILL_RECT_200, FILL_FRAME_200);
    // left = 0.9 * 200 = 180
    expect(result.left).toBeCloseTo(180);
    expect(result.width).toBeCloseTo(20);
  });

  it('handles zero-width rect by returning a zero-width preview rect', () => {
    const bbox = { x: 0.5, y: 0.5, width: 0.2, height: 0.2 };
    const rect = { width: 0, height: 200 };
    const result = mapBoxToPreview(bbox, rect, { width: 0, height: 200 });
    expect(result.width).toBe(0);
    expect(result.height).toBe(40);
    expect(result.left).toBe(0);
  });

  it('handles zero-height rect by returning a zero-height preview rect', () => {
    const bbox = { x: 0.5, y: 0.5, width: 0.2, height: 0.2 };
    const rect = { width: 200, height: 0 };
    const result = mapBoxToPreview(bbox, rect, { width: 200, height: 0 });
    expect(result.width).toBe(40);
    expect(result.height).toBe(0);
    expect(result.top).toBe(0); // 0.5 * 0 = 0
  });

  it('clamps bbox values outside [0,1] to [0,1]', () => {
    // Bbox with x and width extending beyond 1.0
    const bbox = { x: 0.8, y: 0.1, width: 0.5, height: 0.1 };
    // After clamping: x' = 0.8, width' = 0.2 (clamped from 0.5 to end at 1.0)
    // No mirror: left = 0.8 * 100 = 80
    const result = mapBoxToPreview(bbox, FILL_RECT_100, FILL_FRAME_100);
    expect(result.left).toBeCloseTo(80);
    expect(result.width).toBeCloseTo(20);
    expect(result.top).toBeCloseTo(10);
    expect(result.height).toBeCloseTo(10);
  });

  it('clamps negative x coordinate to 0', () => {
    const bbox = { x: -0.1, y: 0.5, width: 0.3, height: 0.2 };
    // After clamping: x' = 0, then width' = min(1 - 0, 0.3) = 0.3
    // No mirror: left = 0 * 100 = 0
    const result = mapBoxToPreview(bbox, FILL_RECT_100, FILL_FRAME_100);
    expect(result.left).toBe(0);
    expect(result.width).toBe(30);
  });

  it('clamps negative y coordinate to 0', () => {
    const bbox = { x: 0.5, y: -0.1, width: 0.2, height: 0.3 };
    // After clamping: y' = 0, then height' = min(1 - 0, 0.3) = 0.3
    // top = 0 * 100 = 0
    const result = mapBoxToPreview(bbox, FILL_RECT_100, FILL_FRAME_100);
    expect(result.top).toBe(0);
    expect(result.height).toBe(30);
  });

  it('scales X and Y linearly and identically (no mirroring on either axis)', () => {
    const bbox1 = { x: 0.5, y: 0.1, width: 0.1, height: 0.1 };
    const bbox2 = { x: 0.5, y: 0.9, width: 0.1, height: 0.1 };
    const result1 = mapBoxToPreview(bbox1, FILL_RECT_100, FILL_FRAME_100);
    const result2 = mapBoxToPreview(bbox2, FILL_RECT_100, FILL_FRAME_100);
    expect(result1.top).toBe(10);
    expect(result2.top).toBe(90);
  });

  // --- resizeMode="contain" letterbox/pillarbox accounting -----------------
  // Reproduces the on-device bug: a wide/short rect (e.g. a preview card) with
  // a narrow/tall camera frame (portrait-oriented sensor output) renders
  // pillarboxed -- the actual image occupies a centered sub-rect narrower
  // than the full rect, with black bars on both sides. A bbox normalized
  // against the frame must map onto that sub-rect, not the full rect.

  it('pillarboxes a narrow frame inside a wide rect: face centered in frame maps to centered sub-rect', () => {
    const rect = { width: 400, height: 100 }; // wide, short container
    const frameSize = { width: 100, height: 200 }; // narrow, tall frame (aspect 0.5)
    // contain scale = min(400/100, 100/200) = min(4, 0.5) = 0.5
    // displayed image: 50 wide x 100 tall, centered -> offsetX = (400-50)/2 = 175, offsetY = 0
    const bbox = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }; // small centered box
    const result = mapBoxToPreview(bbox, rect, frameSize);
    // sub-rect local, no mirror: subX = 0.4*50=20 -> rect-local left = 175 + 20 = 195
    expect(result.left).toBeCloseTo(195);
    expect(result.top).toBeCloseTo(0 + 0.4 * 100); // offsetY(0) + 0.4*displayedHeight(100) = 40
    expect(result.width).toBeCloseTo(10);
    expect(result.height).toBeCloseTo(20);
  });

  it('pillarboxed frame: a face at the very left edge of the frame maps to the left edge of the displayed sub-rect (no mirror)', () => {
    const rect = { width: 400, height: 100 };
    const frameSize = { width: 100, height: 200 };
    // displayed image is 50 wide, centered with offsetX=175 (as above)
    const bbox = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const result = mapBoxToPreview(bbox, rect, frameSize);
    // subX=0 -> rect-local left = 175 + 0 = 175 (the sub-rect's own left edge)
    expect(result.left).toBeCloseTo(175);
    expect(result.width).toBeCloseTo(5);
    // Box must land within the displayed sub-rect, never inside a black bar:
    expect(result.left).toBeGreaterThanOrEqual(175);
    expect(result.left + result.width).toBeLessThanOrEqual(225);
  });

  it('letterboxes a wide frame inside a narrow/tall rect (top/bottom bars instead of left/right)', () => {
    const rect = { width: 100, height: 400 }; // narrow, tall container
    const frameSize = { width: 200, height: 100 }; // wide, short frame (aspect 2)
    // contain scale = min(100/200, 400/100) = min(0.5, 4) = 0.5
    // displayed image: 100 wide x 50 tall, centered -> offsetX=0, offsetY=(400-50)/2=175
    const bbox = { x: 0.5, y: 0.5, width: 0.1, height: 0.1 };
    const result = mapBoxToPreview(bbox, rect, frameSize);
    // subX=0.5*100=50, no mirror -> rect-local left=0+50=50
    expect(result.left).toBeCloseTo(50);
    // subY=0.5*50=25 -> rect-local top = 175+25 = 200
    expect(result.top).toBeCloseTo(200);
    expect(result.width).toBeCloseTo(10);
    expect(result.height).toBeCloseTo(5);
  });

  it('matching-aspect-ratio frame and rect produce zero letterbox offset (backward-compatible with a fully-filling preview)', () => {
    const rect = { width: 300, height: 150 };
    const frameSize = { width: 600, height: 300 }; // same 2:1 aspect ratio, different absolute size
    const bbox = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const result = mapBoxToPreview(bbox, rect, frameSize);
    // Same result as if frame exactly matched rect's own aspect ratio: no offset
    expect(result.left).toBeCloseTo(75); // 0.25*300 = 75
    expect(result.top).toBeCloseTo(37.5); // 0.25*150
    expect(result.width).toBeCloseTo(150);
    expect(result.height).toBeCloseTo(75);
  });
});

// Field-of-view mismatch (on-device: front sensor active array 4608x3456 =
// 4:3, preview stream 1440x1080 = 4:3 full FOV, analysis stream 1280x720 =
// 16:9). No CameraX ViewPort is set by VisionCamera, so each stream is the
// HAL's centred max-FOV crop of the sensor for its own aspect ratio: the
// 16:9 analysis frame is a centred crop of the 4:3 preview, and the
// PreviewView (FIT_CENTER) shows the WHOLE 4:3 preview image.
describe('analysisCropInPreview', () => {
  it('portrait (upright 9:16 analysis inside upright 3:4 preview): full height, centred 75% width', () => {
    const crop = analysisCropInPreview({ width: 720, height: 1280 }, { width: 1080, height: 1440 });
    expect(crop.x).toBeCloseTo(0.125);
    expect(crop.y).toBeCloseTo(0);
    expect(crop.width).toBeCloseTo(0.75);
    expect(crop.height).toBeCloseTo(1);
  });

  it('landscape (16:9 analysis inside 4:3 preview): full width, centred 75% height', () => {
    const crop = analysisCropInPreview({ width: 1280, height: 720 }, { width: 1440, height: 1080 });
    expect(crop.x).toBeCloseTo(0);
    expect(crop.y).toBeCloseTo(0.125);
    expect(crop.width).toBeCloseTo(1);
    expect(crop.height).toBeCloseTo(0.75);
  });

  it('same aspect ratio -> identity crop', () => {
    expect(analysisCropInPreview({ width: 640, height: 480 }, { width: 1440, height: 1080 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});

describe('mapBoxToPreview against the displayed PREVIEW image (previewFrameSize)', () => {
  it('landscape: maps the analysis frame as a centred crop of the contain-fit 4:3 preview, not a contain-fit of the 16:9 frame', () => {
    const rect = { width: 352, height: 140 };
    // preview 1440x1080 contain-fit: scale = min(352/1440, 140/1080) = 0.12963
    // -> displayed 186.667 x 140, offsetX = (352-186.667)/2 = 82.667
    // analysis crop = full width, y 0.125..0.875 -> 186.667 x 105 at top 17.5
    const full = mapBoxToPreview(
      { x: 0, y: 0, width: 1, height: 1 },
      rect,
      { width: 1280, height: 720 },
      { width: 1440, height: 1080 },
    );
    expect(full.left).toBeCloseTo(82.667, 2);
    expect(full.top).toBeCloseTo(17.5, 2);
    expect(full.width).toBeCloseTo(186.667, 2);
    expect(full.height).toBeCloseTo(105, 2);
  });

  it('portrait in a wide card (the on-device geometry): coincides with the plain contain-fit of the upright analysis frame', () => {
    const rect = { width: 352, height: 140 };
    const bbox = { x: 0.3, y: 0.44, width: 0.29, height: 0.165 };
    const viaPreview = mapBoxToPreview(bbox, rect, { width: 720, height: 1280 }, { width: 1080, height: 1440 });
    const plain = mapBoxToPreview(bbox, rect, { width: 720, height: 1280 });
    expect(viaPreview.left).toBeCloseTo(plain.left, 6);
    expect(viaPreview.top).toBeCloseTo(plain.top, 6);
    expect(viaPreview.width).toBeCloseTo(plain.width, 6);
    expect(viaPreview.height).toBeCloseTo(plain.height, 6);
  });

  it('portrait in a narrow/tall card: preview width constrains, so the crop-aware mapping differs from plain contain-fit', () => {
    const rect = { width: 90, height: 400 };
    // preview 1080x1440 contain: scale = min(90/1080, 400/1440) = 0.08333
    // -> 90 x 120, offsetY = 140; crop x 0.125..0.875 -> 67.5 x 120 at left 11.25
    const full = mapBoxToPreview(
      { x: 0, y: 0, width: 1, height: 1 },
      rect,
      { width: 720, height: 1280 },
      { width: 1080, height: 1440 },
    );
    expect(full.left).toBeCloseTo(11.25, 4);
    expect(full.top).toBeCloseTo(140, 4);
    expect(full.width).toBeCloseTo(67.5, 4);
    expect(full.height).toBeCloseTo(120, 4);
  });
});
