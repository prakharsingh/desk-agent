import React, { useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import { useCameraDevice, Camera } from 'react-native-vision-camera';
import { useCameraLifecycle } from './useCameraLifecycle.js';
import { useFaceFrameProcessor } from './frameProcessor.js';
import { deriveSignals, type MotionSourceState, type FaceObservation } from './signalDeriver.js';
import { deriveEdges, INITIAL_EDGE_EMITTER_STATE, type EdgeEmitterState } from './edgeEmitter.js';
import { buildFaceVisibleFrame, buildGazeFrame, buildMotionFrame, buildCameraStateFrame } from '../presenceEvents.js';

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
}: {
  enabled: boolean;
  send: (json: string) => void;
  connectionEpoch: number;
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
      return;
    }
    if (lifecycle === 'denied') {
      send(JSON.stringify(buildCameraStateFrame('error', 'permission-denied')));
      return;
    }
    if (lifecycle === 'granted' && device) {
      send(JSON.stringify(buildCameraStateFrame('active')));
    }
  }, [enabled, lifecycle, device, send, connectionEpoch]);

  const handleObservation = (obs: FaceObservation) => {
    const { signals, nextMotionState } = deriveSignals(obs, motionStateRef.current);
    motionStateRef.current = nextMotionState;
    const { edges, nextState } = deriveEdges(signals, edgeStateRef.current, Date.now(), MIN_DWELL_MS);
    edgeStateRef.current = nextState;
    if (edges.faceVisible !== undefined) send(JSON.stringify(buildFaceVisibleFrame(edges.faceVisible)));
    if (edges.gazeAtScreen !== undefined) send(JSON.stringify(buildGazeFrame(edges.gazeAtScreen)));
    if (edges.motionActive !== undefined) send(JSON.stringify(buildMotionFrame(edges.motionActive)));
  };

  const cameraFrameOutput = useFaceFrameProcessor(handleObservation);

  // Real teardown: when disabled (or permission/device aren't ready), this
  // component returns null and unmounts `<Camera>` entirely rather than
  // rendering it with isActive={false} -- unmounting drops the underlying
  // CameraSession/capture pipeline, which is what actually releases the OS
  // camera-in-use indicator. isActive is still passed through below for the
  // brief window while mounted and enabled toggles mid-lifecycle.
  if (!enabled || lifecycle !== 'granted' || !device) return null;

  return (
    <Camera
      style={{ width: 1, height: 1, opacity: 0 }}
      device={device}
      isActive={enabled}
      outputs={[cameraFrameOutput]}
      constraints={[{ fps: TARGET_FPS }]}
    />
  );
}
