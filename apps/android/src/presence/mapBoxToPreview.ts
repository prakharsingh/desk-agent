/**
 * Normalized face bounding box from camera frame processing.
 * Coordinates are fractions of frame dimensions in [0, 1] range.
 */
export interface NormalizedBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Preview rendering rectangle dimensions in pixels.
 */
export interface PreviewRect {
  width: number;
  height: number;
}

/**
 * Camera frame dimensions (pixels) that the bbox is normalized against --
 * same units as `frame.width`/`frame.height` in the frame-processor worklet.
 * Only the aspect ratio (width/height) matters for the letterbox math below;
 * absolute values need not match the preview's own analysis-stream resolution.
 */
export interface FrameSize {
  width: number;
  height: number;
}

/**
 * Absolute pixel coordinates for positioning an SVG rect overlay.
 */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Maps a normalized camera bounding box to preview-pixel coordinates.
 *
 * The camera emits face bounding boxes as fractions of the frame ([0,1]).
 * This function transforms them to pixel coordinates suitable for an SVG
 * overlay on the preview, accounting for `resizeMode="contain"`'s
 * letterbox/pillarbox fitting (the preview's `<Camera>` renders with
 * `resizeMode="contain"`, so unless the frame's aspect ratio exactly
 * matches the rect's, the displayed image occupies a centered
 * sub-rectangle of `rect`, not the full rect -- black bars fill the
 * remainder).
 *
 * **Contain-fit sub-rect:**
 * `frameSize`'s aspect ratio determines a scale (the smaller of
 * `rect.width/frameSize.width` and `rect.height/frameSize.height`) and a
 * centered offset within `rect`. The bbox is mapped onto that sub-rect,
 * not directly onto `rect` -- this is what keeps the overlay box aligned
 * with the actual displayed image instead of drifting into the letterbox
 * bars.
 *
 * **No mirroring here:**
 * This function does NOT flip the X axis and expects `bbox` to already be
 * in the displayed preview's (upright, selfie-mirrored) coordinate space.
 * MLKit's `face.bounds` arrive upright but UNmirrored (the analysis buffer
 * is never physically mirrored; VisionCamera only flags it via
 * `frame.isMirrored`), so the single mirror step happens upstream in
 * `faceBoundsToOverlayRect.ts`'s `faceBoundsToNormalizedBox`. `frameSize`
 * must likewise be the UPRIGHT frame size (see `uprightFrameSize`).
 *
 * **Clamping:**
 * Bounding boxes are clamped to [0,1] before scaling. This handles edge cases
 * where detection might return coordinates slightly outside the frame (due to
 * numerical precision in the face-detection model). Clamping ensures the
 * output rect stays within the displayed sub-rect.
 *
 * **Zero-size rects:**
 * If rect.width or rect.height is 0, the output dimensions scale to 0 accordingly.
 * The position is still calculated; the rect simply renders with zero size.
 *
 * @param bbox Normalized bounding box from camera, fractions in [0,1]
 * @param rect Preview rendering dimensions in pixels
 * @param frameSize Camera frame dimensions the bbox is normalized against
 * @returns Pixel coordinates for SVG rect positioning, relative to rect's origin
 */
/**
 * Where the analysis frame sits inside the preview image, as a normalized
 * [0,1] rect of the preview -- both sizes UPRIGHT.
 *
 * VisionCamera 5.1 binds Preview + ImageAnalysis via a plain CameraX
 * `SessionConfig` with no `ViewPort` (session/ConstraintResolver.kt:69-72),
 * so each stream is the camera HAL's centred, maximum-FOV crop of the
 * sensor active array for that stream's own aspect ratio. On device the
 * front sensor is 4608x3456 (4:3), the preview stream 1440x1080 (4:3, the
 * full FOV) and the analysis stream 1280x720 (16:9) -- i.e. the analysis
 * frame is a centred crop of the preview. This assumes the preview is the
 * wider-FOV reference (true whenever its aspect matches the sensor's).
 */
export function analysisCropInPreview(analysis: FrameSize, preview: FrameSize): NormalizedBBox {
  if (!(analysis.width > 0 && analysis.height > 0 && preview.width > 0 && preview.height > 0)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const analysisAspect = analysis.width / analysis.height;
  const previewAspect = preview.width / preview.height;
  if (Math.abs(analysisAspect - previewAspect) < 1e-6) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  if (analysisAspect > previewAspect) {
    // Analysis is wider: it keeps the full width, crops top/bottom.
    const height = previewAspect / analysisAspect;
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  }
  // Analysis is narrower: full height, crops left/right.
  const width = analysisAspect / previewAspect;
  return { x: (1 - width) / 2, y: 0, width, height: 1 };
}

/**
 * @param previewFrameSize Optional UPRIGHT size of the preview stream that
 *   the PreviewView actually displays. When given, the contain-fit is done
 *   on the PREVIEW image (what is on screen) and the analysis frame is
 *   mapped into it as a centred crop (see `analysisCropInPreview`). When
 *   omitted, the analysis frame itself is assumed to be what is displayed.
 */
export function mapBoxToPreview(
  bbox: NormalizedBBox,
  rect: PreviewRect,
  frameSize: FrameSize,
  previewFrameSize?: FrameSize | null,
): PixelRect {
  // Clamp bbox coordinates and dimensions to [0,1]
  const x = Math.max(0, Math.min(1, bbox.x));
  const y = Math.max(0, Math.min(1, bbox.y));
  const width = Math.max(0, Math.min(1 - x, bbox.width));
  const height = Math.max(0, Math.min(1 - y, bbox.height));

  // resizeMode="contain": scale by whichever axis constrains first, then
  // center the result within rect. Guard against a zero-dimension frameSize
  // (division by zero) by treating it the same as a same-aspect-ratio frame,
  // i.e. no letterboxing -- there's no meaningful frame to fit otherwise.
  // The image actually displayed: the preview stream when known, else the
  // analysis frame.
  const shown = previewFrameSize ?? frameSize;
  const scale =
    shown.width > 0 && shown.height > 0 ? Math.min(rect.width / shown.width, rect.height / shown.height) : 1;
  const imageWidth = shown.width > 0 ? shown.width * scale : rect.width;
  const imageHeight = shown.height > 0 ? shown.height * scale : rect.height;
  // ...and the analysis frame's region within it.
  const crop = previewFrameSize ? analysisCropInPreview(frameSize, previewFrameSize) : { x: 0, y: 0, width: 1, height: 1 };
  const displayedWidth = imageWidth * crop.width;
  const displayedHeight = imageHeight * crop.height;
  const offsetX = (rect.width - imageWidth) / 2 + crop.x * imageWidth;
  const offsetY = (rect.height - imageHeight) / 2 + crop.y * imageHeight;

  // Position within the displayed sub-rect, no mirror (see doc comment above)
  const subX = x * displayedWidth;
  const subY = y * displayedHeight;
  const subWidth = width * displayedWidth;
  const subHeight = height * displayedHeight;

  const left = offsetX + subX;
  const top = offsetY + subY;

  return {
    left,
    top,
    width: subWidth,
    height: subHeight,
  };
}
