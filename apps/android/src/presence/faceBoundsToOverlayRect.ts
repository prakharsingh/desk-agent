import { mapBoxToPreview, type FrameSize, type NormalizedBBox, type PixelRect, type PreviewRect } from './mapBoxToPreview.js';

/** VisionCamera v5's `Frame.orientation` union (specs/common-types/CameraOrientation.ts). */
export type FrameOrientation = 'up' | 'right' | 'down' | 'left';

/** Raw MLKit `face.bounds`, in pixels. */
export interface FaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceFrameGeometry {
  /** Analysis buffer width in pixels (`frame.width`, e.g. 1280 -- landscape). */
  frameWidth: number;
  /** Analysis buffer height in pixels (`frame.height`, e.g. 720). */
  frameHeight: number;
  /** The buffer's `imageInfo.rotationDegrees` (0/90/180/270). */
  rotationDegrees: number;
  /**
   * Whether the displayed preview is mirrored relative to the analysis
   * buffer (VisionCamera's `frame.isMirrored`: output mirrored, buffer not).
   */
  mirrored: boolean;
}

/**
 * Inverse of VisionCamera's Android `CameraOrientation.fromDegrees`
 * (android/.../extensions/CameraOrientation+degrees.kt:15-23: 45..135 ->
 * LEFT, 135..225 -> DOWN, 225..315 -> RIGHT, else UP), which is how
 * `Frame.orientation` is derived from `imageInfo.rotationDegrees`
 * (extensions/ImageProxy+orientation.kt). The face-detector plugin hands
 * MLKit that same `imageInfo.rotationDegrees`.
 */
export function orientationToRotationDegrees(orientation: FrameOrientation): number {
  switch (orientation) {
    case 'left':
      return 90;
    case 'down':
      return 180;
    case 'right':
      return 270;
    default:
      return 0;
  }
}

/**
 * The size of the frame once rotated upright. MLKit receives the buffer plus
 * `rotationDegrees` and returns `face.bounds` already in this upright space,
 * so this -- not the raw landscape buffer size -- is what bounds must be
 * normalized against.
 */
export function uprightFrameSize(frameWidth: number, frameHeight: number, rotationDegrees: number): FrameSize {
  const r = ((rotationDegrees % 360) + 360) % 360;
  return r === 90 || r === 270
    ? { width: frameHeight, height: frameWidth }
    : { width: frameWidth, height: frameHeight };
}

/**
 * MLKit upright pixel bounds -> [0,1] box in the coordinate space of the
 * displayed (selfie-mirrored) preview. X is mirrored exactly once, because
 * the analysis buffer is not physically mirrored but the preview is.
 */
export function faceBoundsToNormalizedBox(bounds: FaceBounds, geometry: FaceFrameGeometry): NormalizedBBox {
  const { width: uW, height: uH } = uprightFrameSize(geometry.frameWidth, geometry.frameHeight, geometry.rotationDegrees);
  const x = bounds.x / uW;
  const w = bounds.width / uW;
  return {
    x: geometry.mirrored ? 1 - x - w : x,
    y: bounds.y / uH,
    width: w,
    height: bounds.height / uH,
  };
}

/**
 * MLKit `face.bounds` -> overlay rect (dp, relative to the preview rect's
 * origin) for a `resizeMode="contain"` preview of the upright frame.
 */
export function faceBoundsToOverlayRect(bounds: FaceBounds, geometry: FaceFrameGeometry, rect: PreviewRect): PixelRect {
  return mapBoxToPreview(
    faceBoundsToNormalizedBox(bounds, geometry),
    rect,
    uprightFrameSize(geometry.frameWidth, geometry.frameHeight, geometry.rotationDegrees),
  );
}
