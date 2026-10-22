import React, { useEffect, useMemo, useRef } from 'react';
import { NativeModules, StyleSheet, View } from 'react-native';
import {
  useCamera,
  useCameraDevice,
  usePreviewOutput,
  NativePreviewView,
  type CameraDevice,
  type CameraFrameOutput,
  type CameraOutput,
  type CameraPreviewOutput,
} from 'react-native-vision-camera';
import { useCameraLifecycle } from './useCameraLifecycle.js';
import { useFaceFrameProcessor } from './frameProcessor.js';
import { deriveSignals, type MotionSourceState, type FaceObservation } from './signalDeriver.js';
import { deriveEdges, INITIAL_EDGE_EMITTER_STATE, type EdgeEmitterState } from './edgeEmitter.js';
import { buildFaceVisibleFrame, buildGazeFrame, buildMotionFrame, buildCameraStateFrame } from '../presenceEvents.js';
import type { SensorFrame } from '../display/sensorFrame.js';
import { FaceBoxOverlay, type FaceBoxOverlayHandle } from './FaceBoxOverlay.js';
import {
  faceBoundsToNormalizedBox,
  orientationToRotationDegrees,
  uprightFrameSize,
} from './faceBoundsToOverlayRect.js';

const MIN_DWELL_MS = 2000;

// Target frame rate for the presence pipeline. Verified against the real
// installed VisionCamera v5.1.0 types (see CORRECTION note below for the
// verification trail) -- there is no `fps` prop on `<Camera>` itself; the
// real mechanism is a `{ fps }` entry in the `constraints` array, which the
// CameraSession negotiates against the device's supported configs.
const TARGET_FPS = 15;
// Hoisted so the array identity is stable across renders.
const CAMERA_CONSTRAINTS = [{ fps: TARGET_FPS }];
// Throttle for the on-device "facebox" debug log (see handleObservation).
const FACEBOX_LOG_INTERVAL_MS = 1000;

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
 *     `constraints: [{ fps: TARGET_FPS }]` (now passed to `useCamera`).
 *
 * `useCameraDevice('front')` (Task C2/brief) is unchanged and confirmed real
 * (`hooks/useCameraDevice.d.ts:20`).
 */
// Memoized: AppShell (this component's parent) re-renders every second from
// App.tsx's 1Hz clock tick (`now`), and without React.memo a plain function
// component re-renders every time its parent does, regardless of whether its
// own props changed. Every CameraPresence render re-invokes useCameraDevice/
// useFaceDetector/useFrameOutput (see frameProcessor.ts) unconditionally,
// each of which allocates native camera/face-detector JNI objects
// (HybridCameraDevice, HybridFaceDetectorSpec$CxxPart) -- found on-device via
// a reproducible crash: `JNI ERROR (app bug): global reference table
// overflow (max=51200)`, with those exact classes filling the last entries
// of the reference table dump. All of this component's props (enabled, send,
// connectionEpoch, onSensor, previewRect) are already referentially stable
// from App.tsx/AppShell (useCallback / state that only changes on a real
// event), so React.memo's default shallow-prop comparison correctly skips
// the once-a-second re-render instead of re-allocating native camera
// handles on a clock tick that has nothing to do with the camera.
export const CameraPresence = React.memo(function CameraPresence({
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
   * everywhere else, in which case the camera runs headless (frame output
   * only, no preview surface at all) to keep face detection running.
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
  const lastFaceboxLogRef = useRef(0);
  // The preview output while it is attached (set by PresenceCameraSession),
  // read per observation for its negotiated stream size -- the overlay maps
  // against the displayed PREVIEW image, whose FOV is wider than the
  // analysis frame's (see analysisCropInPreview in mapBoxToPreview.ts).
  const previewOutputRef = useRef<CameraPreviewOutput | null>(null);

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
    // visible preview to overlay onto (previewRect unset).
    //
    // MLKit's face.bounds (obs.rawBounds) are already upright (it is given
    // the buffer's rotationDegrees) and unmirrored, while the buffer itself
    // stays landscape. faceBoundsToNormalizedBox normalizes against the
    // UPRIGHT size and mirrors X once for the selfie preview; the overlay's
    // mapBoxToPreview then contain-fits that upright frame into the rect.
    // obs itself is passed to deriveSignals/deriveEdges below unchanged.
    if (previewRect) {
      if (obs.rawBounds && obs.frameWidth && obs.frameHeight) {
        const geometry = {
          frameWidth: obs.frameWidth,
          frameHeight: obs.frameHeight,
          rotationDegrees: orientationToRotationDegrees(obs.orientation ?? 'up'),
          mirrored: obs.isMirrored ?? false,
        };
        // Preview resolution is reported in sensor orientation like the
        // analysis buffer, so it is rotated upright by the same amount.
        const previewRes = previewOutputRef.current?.currentResolution;
        const previewFrameSize = previewRes
          ? uprightFrameSize(previewRes.width, previewRes.height, geometry.rotationDegrees)
          : null;
        overlayRef.current?.setBBox({
          bbox: faceBoundsToNormalizedBox(obs.rawBounds, geometry),
          frameSize: uprightFrameSize(geometry.frameWidth, geometry.frameHeight, geometry.rotationDegrees),
          previewFrameSize,
        });
        // Single on-device debug line for the face-box alignment check:
        // `adb logcat -s ReactNativeJS | grep facebox`. Throttled to <=1/s
        // and only while the Presence preview is visible.
        const now = Date.now();
        if (now - lastFaceboxLogRef.current >= FACEBOX_LOG_INTERVAL_MS) {
          lastFaceboxLogRef.current = now;
          const b = obs.rawBounds;
          console.log(
            `facebox bounds=${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)} ` +
              `frame=${obs.frameWidth}x${obs.frameHeight} rot=${geometry.rotationDegrees} ` +
              `orientation=${obs.orientation} mirrored=${geometry.mirrored} ` +
              `preview=${previewRes ? `${previewRes.width}x${previewRes.height}` : 'unknown'} ` +
              `rect=${Math.round(previewRect.width)}x${Math.round(previewRect.height)}`
          );
        }
      } else {
        overlayRef.current?.setBBox(null);
      }
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
  // component renders nothing and PresenceCameraSession unmounts, which
  // disposes its CameraSession (useCamera's teardown: stop() +
  // configure([])) -- that is what actually releases the OS camera-in-use
  // indicator.
  if (!enabled || lifecycle !== 'granted' || !device) return null;

  return (
    <PresenceCameraSession
      device={device}
      frameOutput={cameraFrameOutput}
      previewRect={previewRect ?? null}
      overlayRef={overlayRef}
      previewOutputRef={previewOutputRef}
    />
  );
});

/**
 * Owns the single CameraSession for presence detection.
 *
 * BLACK-BLOCK FIX: VisionCamera's `<Camera>` view ALWAYS adds a
 * PreviewOutput (node_modules/react-native-vision-camera/src/views/
 * Camera.tsx:167-175: `usePreviewOutput()` then `outputs: [previewOutput,
 * ...outputs]`) and renders a CameraX PreviewView, whose child SurfaceView
 * gets a full-size buffer and punches a hole through the app window no
 * matter how small/transparent the RN view is (`opacity` can't hide a
 * SurfaceView). The old hidden fallback (`<Camera style={{width:1,height:1,
 * opacity:0}}>`) therefore drew a black block over the app on a cold start
 * with camera presence already on.
 *
 * Instead this uses VisionCamera's headless `useCamera` hook
 * (src/hooks/useCamera.ts:222 -- "creates a CameraSession, manages the
 * input and outputs ... and returns a CameraController"; its own doc
 * example passes `outputs: []` with no view) with ONLY the frame output
 * when hidden, so no Preview use case and no PreviewView/SurfaceView exist
 * at all. When the Presence screen supplies a previewRect, the preview
 * output is added to the same session and a `NativePreviewView` (the host
 * view `<Camera>` itself renders, src/views/NativePreviewView.tsx:42) is
 * mounted at that rect. Toggling visibility only changes `outputs`, which
 * re-runs `session.configure(...)` on the SAME session (internal/
 * useCameraController.ts:72-128 -> HybridCameraSession.kt:54-95 unbindAll +
 * bindToLifecycle while the lifecycle stays active), so detection resumes
 * after a single CameraX rebind instead of a full session teardown.
 *
 * `mirrorMode="on"` applies to every output (useCameraController.ts:91-94):
 * the preview is shown mirrored, and frames report `isMirrored=true`
 * (HybridFrameOutput.kt:129) while the buffer itself is not flipped -- the
 * overlay math mirrors X once to match.
 */
function PresenceCameraSession({
  device,
  frameOutput,
  previewRect,
  overlayRef,
  previewOutputRef,
}: {
  device: CameraDevice;
  frameOutput: CameraFrameOutput;
  previewRect: { x: number; y: number; width: number; height: number } | null;
  overlayRef: React.RefObject<FaceBoxOverlayHandle | null>;
  previewOutputRef: React.MutableRefObject<CameraPreviewOutput | null>;
}) {
  const previewOutput = usePreviewOutput();
  const showPreview = previewRect != null;
  // Memoized on visibility only (not on the rect's identity, which changes
  // on every layout) so the session is reconfigured only on a real
  // hidden <-> visible switch.
  const outputs = useMemo<CameraOutput[]>(
    () => (showPreview ? [previewOutput, frameOutput] : [frameOutput]),
    [showPreview, previewOutput, frameOutput]
  );

  useCamera({
    device,
    isActive: true,
    outputs,
    constraints: CAMERA_CONSTRAINTS,
    mirrorMode: 'on',
  });

  useEffect(() => {
    previewOutputRef.current = showPreview ? previewOutput : null;
    return () => {
      previewOutputRef.current = null;
    };
  }, [showPreview, previewOutput, previewOutputRef]);

  if (!previewRect) return null;

  const previewStyle = {
    position: 'absolute' as const,
    left: previewRect.x,
    top: previewRect.y,
    width: previewRect.width,
    height: previewRect.height,
  };

  // POSITIONING: the rect's left/top go on a plain RN host View, never on
  // NativePreviewView itself. VisionCamera's HybridPreviewView calls
  // `previewView.installHierarchyFitter()` (views/HybridPreviewView.kt init),
  // whose onChildViewAdded does `parent.layout(0, 0, measuredW, measuredH)`
  // on the PreviewView when CameraX adds its SurfaceView child
  // (extensions/ViewGroup+installHierarchyFitter.kt) -- re-laying the
  // PreviewView at (0,0) of ITS parent and discarding RN's left/top while
  // keeping width/height. That put the preview at the top-left of the
  // screen, over the header and BACK. Inside a wrapper sized/positioned at
  // the rect, (0,0) IS the correct spot, so the fitter becomes harmless.
  // `<Camera>` never hits this because it renders the view at 0,0 itself.
  //
  // `resizeMode="contain"` (FIT_CENTER) shows the whole preview stream,
  // letterboxed; the overlay maps against that image (mapBoxToPreview with
  // previewFrameSize). Always passed with the same value: this view only
  // ever mounts/unmounts, it is never updated to a state without resizeMode
  // (see the Fabric null-prop crash that the old single-<Camera> design had
  // to guard against).
  return (
    <>
      <View style={[previewStyle, styles.previewClip]} pointerEvents="none">
        <NativePreviewView style={StyleSheet.absoluteFill} previewOutput={previewOutput} resizeMode="contain" />
      </View>
      <View style={previewStyle}>
        <FaceBoxOverlay ref={overlayRef} rect={{ width: previewRect.width, height: previewRect.height }} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  previewClip: { overflow: 'hidden' },
});
