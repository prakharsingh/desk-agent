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
 * This function does NOT flip the X axis. `CameraPresence`'s `<Camera>`
 * sets `mirrorMode="on"`, and on-device verification (a static face,
 * confirmed non-tracking/non-latency via repeated identical screenshots)
 * showed VisionCamera mirrors the ENTIRE pipeline under that setting --
 * not just the displayed `PreviewView`, but also the analysis frames MLKit
 * reads. `face.bounds` therefore already arrives in already-mirrored,
 * display-matching coordinates; an earlier version of this function
 * additionally flipped the X axis (assuming `bbox` was raw/unmirrored),
 * which double-mirrored the box back to the wrong side of the frame. If
 * `mirrorMode` is ever changed to `"off"`, this function would need a
 * mirror step reinstated to match.
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
export function mapBoxToPreview(bbox: NormalizedBBox, rect: PreviewRect, frameSize: FrameSize): PixelRect {
  // Clamp bbox coordinates and dimensions to [0,1]
  const x = Math.max(0, Math.min(1, bbox.x));
  const y = Math.max(0, Math.min(1, bbox.y));
  const width = Math.max(0, Math.min(1 - x, bbox.width));
  const height = Math.max(0, Math.min(1 - y, bbox.height));

  // resizeMode="contain": scale by whichever axis constrains first, then
  // center the result within rect. Guard against a zero-dimension frameSize
  // (division by zero) by treating it the same as a same-aspect-ratio frame,
  // i.e. no letterboxing -- there's no meaningful frame to fit otherwise.
  const scale =
    frameSize.width > 0 && frameSize.height > 0
      ? Math.min(rect.width / frameSize.width, rect.height / frameSize.height)
      : 1;
  const displayedWidth = frameSize.width > 0 ? frameSize.width * scale : rect.width;
  const displayedHeight = frameSize.height > 0 ? frameSize.height * scale : rect.height;
  const offsetX = (rect.width - displayedWidth) / 2;
  const offsetY = (rect.height - displayedHeight) / 2;

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
