import React, { useEffect, useRef } from 'react';
import { NativeModules, View } from 'react-native';
import { useCameraDevice, Camera } from 'react-native-vision-camera';
import { useCameraLifecycle } from './useCameraLifecycle.js';
import { useFaceFrameProcessor } from './frameProcessor.js';
import { deriveSignals, type MotionSourceState, type FaceObservation } from './signalDeriver.js';
import { deriveEdges, INITIAL_EDGE_EMITTER_STATE, type EdgeEmitterState } from './edgeEmitter.js';
import { buildFaceVisibleFrame, buildGazeFrame, buildMotionFrame, buildCameraStateFrame } from '../presenceEvents.js';
import type { SensorFrame } from '../display/sensorFrame.js';
import { FaceBoxOverlay, type FaceBoxOverlayHandle } from './FaceBoxOverlay.js';
import { orientBBoxForPreview } from './orientBBoxForPreview.js';

const MIN_DWELL_MS = 2000;

// Target frame rate for the presence pipeline. Verified against the real
// installed VisionCamera v5.1.0 types (see CORRECTION note below for the
// verification trail) -- there is no `fps` prop on `<Camera>` itself; the
// real mechanism is a `{ fps }` entry in the `constraints` array, which the
// CameraSession negotiates against the device's supported configs.
const TARGET_FPS = 15;

/**
 * CORRECTION (post-C2, verified against real installed types -- same
 * discipline Task C2 used for `useFrameOutput`/`CameraFrameOutput`):
 *
 * `<Camera>`'s props are `CameraViewProps`, defined in
 * `node_modules/react-native-vision-camera/lib/views/Camera.d.ts:56` as
 * `CameraViewProps extends CameraProps, Pick<ViewProps, 'style' | ...>, ...`.
 * `CameraProps` itself lives in `lib/hooks/useCamera.d.ts:10-170`. Verified
 * directly against that file:
 *
 *   - `isActive: boolean` -- real, required. (useCamera.d.ts:19)
 *   - `device: CameraDevice | CameraPosition` -- real, required, still a
 *     direct prop (not nested). (useCamera.d.ts:27)
 *   - `outputs?: CameraOutput[]` -- real, confirmed independently by the
 *     brief and by Task C2's `CameraFrameOutput`. (useCamera.d.ts:34)
 *   - No `fps` prop exists directly on `CameraProps`/`CameraViewProps`.
 *     Instead there is `constraints?: Constraint[]`, and
 *     `specs/common-types/Constraint.ts` defines `FPSConstraint { fps:
 *     number }` as one of the `Constraint` union members, with a worked
 *     example `{ fps: 60 }` in the module doc comment (Constraint.ts:19-22,
 *     181-187). This *is* Task C6's fps-control knob: pass
 *     `constraints={[{ fps: TARGET_FPS }]}` on `<Camera>`.
 *
 * `useCameraDevice('front')` (Task C2/brief) is unchanged and confirmed real
 * (`hooks/useCameraDevice.d.ts:20`).
 */
export function CameraPresence({
  enabled,
  send,
  connectionEpoch,
  onSensor,
  previewRect,
}: {
  enabled: boolean;
  send: (json: string) => void;
  connectionEpoch: number;
  onSensor?: (partial: Partial<SensorFrame>) => void;
  /**
   * Window-absolute pixel rect (as returned by RN's `measureInWindow`) to
   * render a visible camera preview + face-box overlay into. Supplied only
   * on the PRESENCE screen (wired up in later tasks); `null`/`undefined`
   * everywhere else, which preserves the original invisible `1x1, opacity 0`
   * render used purely to keep face detection running off-screen.
   */
  previewRect?: { x: number; y: number; width: number; height: number } | null;
}) {
  const lifecycle = useCameraLifecycle(enabled);
  const device = useCameraDevice('front');
  // Pipeline accumulators, not UI state -- nothing rendered depends on
  // these, so they live in refs rather than useState. Previously these were
  // useState, which forced a full React re-render on every camera frame
  // (~15/sec) purely to thread accumulator state forward, and recreated
  // `handleObservation`/the frame-output worklet binding every render.
  const motionStateRef = useRef<MotionSourceState>({ prevFaceCount: 0 });
  const edgeStateRef = useRef<EdgeEmitterState>(INITIAL_EDGE_EMITTER_STATE);
  // Imperative handle for the face-box overlay -- see FaceBoxOverlay.tsx.
  // Only populated/used when previewRect is set (visible-preview branch);
  // pushing bbox updates through a ref rather than state avoids forcing a
  // CameraPresence re-render on every camera frame.
  const overlayRef = useRef<FaceBoxOverlayHandle>(null);

  useEffect(() => {
    // NativeModules.PresenceService is added in Task C5 -- guarded so this
    // component works even before that task lands.
    if (enabled) {
      NativeModules.PresenceService?.start();
    } else {
      NativeModules.PresenceService?.stop();
    }

    // Reset edge bookkeeping on every real lifecycle/reconnect transition
    // this effect fires for, treating the next observation as a fresh
    // "first observation" that unconditionally re-emits all three current
    // sensor edges. This closes a staleness gap: `wsClient.send()` silently
    // drops a frame while the socket isn't OPEN, but `edgeEmitter` records
    // the edge as emitted regardless of delivery -- so a transition emitted
    // during a reconnect window was previously lost forever (the signal
    // would only re-emit on its NEXT change, which may never come), leaving
    // the Mac's PresenceEngine stuck on a stale value. Mirrors the
    // camera_state re-announcement below, which already had this property.
    motionStateRef.current = { prevFaceCount: 0 };
    edgeStateRef.current = INITIAL_EDGE_EMITTER_STATE;

    // Don't announce camera_state before the first real WS connection --
    // there is nothing to release/activate from the Mac's perspective yet.
    // Without this guard, mounting with the privacy switch off (the default
    // state) unconditionally announced camera_state('released') for a
    // camera that was never active, which on the Mac forces present and
    // cancels the boot-confirmation timer for no real reason. From the
    // first `connectionEpoch` bump onward, this also satisfies the
    // reconnect-resync intent (F6): re-announce current state on every
    // fresh connection, even when `enabled`/`lifecycle`/`device` haven't
    // changed (Mac core restarts should not leave the phone silently
    // stale).
    if (connectionEpoch === 0) return;

    if (!enabled) {
      send(JSON.stringify(buildCameraStateFrame('released')));
      onSensor?.({ cameraState: 'released' });
      return;
    }
    if (lifecycle === 'denied') {
      send(JSON.stringify(buildCameraStateFrame('error', 'permission-denied')));
      onSensor?.({ cameraState: 'error' });
      return;
    }
    if (lifecycle === 'granted' && device) {
      send(JSON.stringify(buildCameraStateFrame('active')));
      onSensor?.({ cameraState: 'active' });
    }
  }, [enabled, lifecycle, device, send, connectionEpoch, onSensor]);

  const handleObservation = (obs: FaceObservation) => {
    // Push the bbox to the visible-preview overlay every frame (not gated on
    // edges -- the box should track continuously). No-op when there's no
    // visible preview to overlay onto (previewRect unset), which preserves
    // the exact current per-frame work/re-render profile on every screen
    // other than PRESENCE.
    //
    // obs.bbox/frameWidth/frameHeight are in the camera's raw sensor buffer
    // orientation (landscape), not the portrait orientation the preview
    // displays -- confirmed on-device (see orientBBoxForPreview.ts's doc
    // comment). Corrected here (JS thread), not in frameProcessor.ts's
    // worklet, because the worklet runtime cannot synchronously call a
    // plain function from a regular module. frameWidth/frameHeight are
    // swapped to match the corrected bbox, both required together for
    // mapBoxToPreview's letterbox math (resizeMode="contain") to line up
    // with the displayed image.
    //
    // obs itself (raw orientation) is passed to deriveSignals/deriveEdges
    // below unchanged -- motion detection there only compares bbox centroid
    // deltas frame-to-frame, which a fixed, consistent transform doesn't
    // affect.
    if (previewRect) {
      overlayRef.current?.setBBox(
        obs.bbox && obs.frameWidth && obs.frameHeight
          ? {
              bbox: orientBBoxForPreview(obs.bbox),
              frameSize: { width: obs.frameHeight, height: obs.frameWidth },
            }
          : null
      );
    }
    const { signals, nextMotionState } = deriveSignals(obs, motionStateRef.current);
    motionStateRef.current = nextMotionState;
    const { edges, nextState } = deriveEdges(signals, edgeStateRef.current, Date.now(), MIN_DWELL_MS);
    edgeStateRef.current = nextState;
    if (edges.faceVisible !== undefined) {
      send(JSON.stringify(buildFaceVisibleFrame(edges.faceVisible)));
      onSensor?.({ faceVisible: edges.faceVisible });
    }
    if (edges.gazeAtScreen !== undefined) {
      send(JSON.stringify(buildGazeFrame(edges.gazeAtScreen)));
      onSensor?.({ gaze: edges.gazeAtScreen });
    }
    if (edges.motionActive !== undefined) {
      send(JSON.stringify(buildMotionFrame(edges.motionActive)));
      onSensor?.({ motion: edges.motionActive });
    }
  };

  const cameraFrameOutput = useFaceFrameProcessor(handleObservation);

  // Real teardown: when disabled (or permission/device aren't ready), this
  // component returns null and unmounts `<Camera>` entirely rather than
  // rendering it with isActive={false} -- unmounting drops the underlying
  // CameraSession/capture pipeline, which is what actually releases the OS
  // camera-in-use indicator. isActive is still passed through below for the
  // brief window while mounted and enabled toggles mid-lifecycle.
  if (!enabled || lifecycle !== 'granted' || !device) return null;

  // `resizeMode`/`mirrorMode` are always passed with a constant value on
  // every render of this <Camera>, regardless of previewRect -- ONLY `style`
  // (and whether the overlay View is mounted) varies with previewRect.
  //
  // BUGFIX (found via on-device crash + logcat, HostFunction exception
  // `PreviewView.resizeMode: Value is null, expected a String`, thrown from
  // React Fabric's `cloneNodeWithNewProps`): this used to be two separate
  // conditional `return` statements -- one <Camera> with resizeMode+
  // mirrorMode set (visible-preview branch), one without (1x1 fallback
  // branch). Fabric reconciled navigating away from PRESENCE (previewRect
  // set -> null) as an UPDATE of the same native view, not a fresh mount,
  // and represented "resizeMode was removed" as an explicit `null` sent to
  // the native setter -- which is typed non-nullable and crashed, freezing
  // the JS render tree. Passing the same resizeMode/mirrorMode value on
  // every render, unconditionally, means Fabric never has to clear them.
  //
  // `resizeMode` is a real prop on CameraViewProps, sourced from
  // `PreviewViewProps` (node_modules/react-native-vision-camera/lib/
  // specs/views/PreviewView.nitro.d.ts: `resizeMode?: PreviewResizeMode`,
  // `'cover' | 'contain'`, default `'cover'`) -- 'contain' keeps the full
  // frame visible without cropping, which is what keeps the mapping
  // between the normalized face bbox and the displayed image proportional
  // (accounted for via mapBoxToPreview's letterbox-aware math).
  //
  // `mirrorMode` is a real prop on `CameraProps`
  // (node_modules/react-native-vision-camera/lib/hooks/useCamera.d.ts:67,
  // type `MirrorMode` from `specs/common-types/MirrorMode.d.ts`), defaulting
  // to `'auto'`, which already mirrors selfie/front cameras automatically.
  // Passed explicitly as `"on"` rather than relying on that `'auto'`
  // default, since this is always a front camera and always wanted
  // mirrored. `mapBoxToPreview` already assumes a mirrored preview when
  // mapping the normalized bbox to preview pixels, so this must keep
  // producing a mirrored image to match that assumption. At 1x1/opacity 0
  // (previewRect unset) neither prop is visually observable, so a constant
  // value here has no effect on the invisible-detection-only behavior.
  const previewStyle = previewRect
    ? {
        position: 'absolute' as const,
        left: previewRect.x,
        top: previewRect.y,
        width: previewRect.width,
        height: previewRect.height,
      }
    : { width: 1, height: 1, opacity: 0 };

  return (
    <>
      <Camera
        style={previewStyle}
        resizeMode="contain"
        mirrorMode="on"
        device={device}
        isActive={enabled}
        outputs={[cameraFrameOutput]}
        constraints={[{ fps: TARGET_FPS }]}
      />
      {previewRect && (
        <View style={previewStyle}>
          <FaceBoxOverlay
            ref={overlayRef}
            rect={{ width: previewRect.width, height: previewRect.height }}
          />
        </View>
      )}
    </>
  );
}
