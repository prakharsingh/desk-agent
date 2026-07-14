import React, { useImperativeHandle, useState } from 'react';
import Svg, { Rect } from 'react-native-svg';
import { mapBoxToPreview, type NormalizedBBox, type PreviewRect, type FrameSize } from './mapBoxToPreview.js';
import { theme } from '../display/theme.js';

export interface FaceBoxObservation {
  bbox: NormalizedBBox;
  /** Camera frame dimensions the bbox is normalized against -- needed to
   * account for resizeMode="contain" letterboxing (see mapBoxToPreview.ts). */
  frameSize: FrameSize;
}

/**
 * Imperative handle for pushing bbox updates into the overlay without
 * forcing the parent (CameraPresence) to hold the bbox in its own state
 * and re-render on every camera frame (~15fps). The parent holds a ref
 * and calls `setBBox` directly from its frame-observation callback.
 */
export interface FaceBoxOverlayHandle {
  setBBox(observation: FaceBoxObservation | null): void;
}

export interface FaceBoxOverlayProps {
  /** Preview rendering rectangle, in pixels -- same rect passed to mapBoxToPreview. */
  rect: PreviewRect;
}

/**
 * SVG overlay that draws a single accent-green stroked bounding box over a
 * camera preview, sized to `rect`. Renders nothing when there is no face.
 *
 * Bbox updates are pushed imperatively via `ref.current.setBBox(...)`
 * (see `FaceBoxOverlayHandle`) rather than through a prop, so only this
 * component re-renders on each update -- not its parent.
 */
export const FaceBoxOverlay = React.forwardRef<FaceBoxOverlayHandle, FaceBoxOverlayProps>(
  function FaceBoxOverlay({ rect }, ref) {
    const [observation, setObservation] = useState<FaceBoxObservation | null>(null);

    useImperativeHandle(ref, () => ({
      setBBox: (next) => setObservation(next),
    }));

    if (!observation) return null;

    const pixelRect = mapBoxToPreview(observation.bbox, rect, observation.frameSize);

    return (
      <Svg width={rect.width} height={rect.height}>
        <Rect
          x={pixelRect.left}
          y={pixelRect.top}
          width={pixelRect.width}
          height={pixelRect.height}
          stroke={theme.colors.accent}
          strokeWidth={2}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    );
  }
);
