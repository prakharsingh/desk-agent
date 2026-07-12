import type { NormalizedBBox } from './mapBoxToPreview.js';

/**
 * Transforms a normalized bounding box from the camera's raw sensor buffer
 * orientation into the portrait `<Camera>` preview's displayed orientation.
 *
 * BACKGROUND (confirmed on-device, OnePlus 6T): `react-native-vision-camera`
 * v5's frame processor delivers `Frame.width`/`Frame.height` and MLKit's
 * `face.bounds` in the camera's raw sensor buffer orientation -- landscape
 * (e.g. 1280x720) -- even though the front camera is physically mounted for
 * portrait use and the displayed `<Camera>` preview shows an upright
 * portrait image (VisionCamera/the OS rotate the PREVIEW for display, but
 * not the raw analysis frame buffer MLKit processes). Naively dividing
 * `face.bounds` by the raw `frame.width`/`frame.height` therefore produces a
 * bbox in the WRONG (landscape, pre-rotation) coordinate space -- overlaying
 * it directly on the portrait preview puts the box nowhere near the actual
 * face.
 *
 * **This is a rotation PLUS a reflection, not a pure 90-degree rotation.**
 * A front camera sensor is commonly mounted as a mirror image of a rear
 * sensor's rotation convention, so a plain 90-degree-clockwise rotation
 * alone is not sufficient. Diagnosis trail (two on-device verification
 * passes, each logging raw `face.bounds` + `frame.width`/`frame.height`
 * alongside a screenshot showing the actual face position):
 *   1. A pure 90-degree-clockwise rotation was tried first (matching a
 *      hand-derived prediction against a screenshot) and got the
 *      HORIZONTAL position right, but placed the box consistently ABOVE
 *      the actual face -- vertically wrong by roughly one box-height, in a
 *      consistent (non-random) direction.
 *   2. Adding a reflection to the vertical component (flipping which end of
 *      the rotated box anchors the top) was then hand-verified against the
 *      same kind of raw-bbox-plus-screenshot capture and placed the box
 *      over the actual face/chin area correctly.
 * A pure 90-degree-counter-clockwise rotation was also checked in an
 * earlier pass and was clearly worse than the clockwise+reflection
 * combination on both axes.
 *
 * @param bbox Normalized bbox in the raw (landscape) frame's coordinate space
 * @returns Normalized bbox in the portrait-preview's displayed coordinate
 *   space. The caller must also swap frameWidth/frameHeight (the new
 *   portrait width is the raw frame's height, and vice versa) when using
 *   this bbox with `mapBoxToPreview`.
 */
export function orientBBoxForPreview(bbox: NormalizedBBox): NormalizedBBox {
  return {
    x: 1 - bbox.y - bbox.height,
    y: 1 - bbox.x - bbox.width,
    width: bbox.height,
    height: bbox.width,
  };
}
