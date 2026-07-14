export interface FaceObservation {
  faceCount: number;
  bbox?: { x: number; y: number; width: number; height: number };
  // The camera frame's own pixel dimensions that bbox is normalized against
  // (same as frame.width/frame.height in the worklet). Only present alongside
  // bbox; needed by the visible-preview overlay to account for
  // resizeMode="contain" letterboxing (see mapBoxToPreview.ts).
  frameWidth?: number;
  frameHeight?: number;
  eulerX?: number;
  eulerY?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
}

export interface DerivedSignals {
  faceVisible: boolean;
  gazeAtScreen: boolean;
  motionActive: boolean;
}

export interface MotionSourceState {
  prevBbox?: { x: number; y: number; width: number; height: number };
  prevFaceCount: number;
}

// Tightened from an initial 25deg to match MLKit's documented
// eye-open-probability reliability ceiling (~18deg) -- see the design spec's
// reality-check correction (finding F5).
const YAW_THRESHOLD_DEG = 18;
const PITCH_THRESHOLD_DEG = 20;
const EYE_OPEN_MIN = 0.5;

// MLKit reports -1 (not `undefined`) when an eye-open probability could not
// be computed for a frame, rather than omitting the field. With the current
// `> EYE_OPEN_MIN` (0.5) comparison, `-1 > 0.5` already evaluates to false
// exactly like `undefined !== undefined`, so this normalization is not
// currently observable in the OR'd leftOpen/rightOpen result -- but it makes
// the "fails closed on unavailable" intent explicit at the boundary rather
// than relying on that comparison-vs-threshold coincidence, which would
// silently stop holding if EYE_OPEN_MIN were ever changed to <= 0.
function normalizeEyeOpenProbability(p: number | undefined): number | undefined {
  return p === undefined || p < 0 ? undefined : p;
}

export function deriveGazeAtScreen(obs: FaceObservation): boolean {
  if (obs.faceCount === 0) return false;
  if (obs.eulerY === undefined || Math.abs(obs.eulerY) >= YAW_THRESHOLD_DEG) return false;
  if (obs.eulerX === undefined || Math.abs(obs.eulerX) >= PITCH_THRESHOLD_DEG) return false;
  const leftProb = normalizeEyeOpenProbability(obs.leftEyeOpenProbability);
  const rightProb = normalizeEyeOpenProbability(obs.rightEyeOpenProbability);
  if (leftProb === undefined && rightProb === undefined) return false;
  const leftOpen = leftProb !== undefined && leftProb > EYE_OPEN_MIN;
  const rightOpen = rightProb !== undefined && rightProb > EYE_OPEN_MIN;
  return leftOpen || rightOpen;
}

const BBOX_CENTROID_DELTA_THRESHOLD = 0.05;

// MLKit-derived motion (design spec decision 5): face bbox centroid delta
// plus appear/disappear -- zero raw-pixel access, sidesteps the documented
// toArrayBuffer() crash risk on this device.
export function deriveMotion(
  obs: FaceObservation,
  prev: MotionSourceState,
): { motionActive: boolean; nextState: MotionSourceState } {
  const appeared = prev.prevFaceCount === 0 && obs.faceCount > 0;
  const disappeared = prev.prevFaceCount > 0 && obs.faceCount === 0;
  let moved = false;
  if (obs.bbox && prev.prevBbox) {
    const dx = Math.abs((obs.bbox.x + obs.bbox.width / 2) - (prev.prevBbox.x + prev.prevBbox.width / 2));
    const dy = Math.abs((obs.bbox.y + obs.bbox.height / 2) - (prev.prevBbox.y + prev.prevBbox.height / 2));
    moved = dx > BBOX_CENTROID_DELTA_THRESHOLD || dy > BBOX_CENTROID_DELTA_THRESHOLD;
  }
  return {
    motionActive: appeared || disappeared || moved,
    nextState: { prevBbox: obs.bbox, prevFaceCount: obs.faceCount },
  };
}

export function deriveSignals(
  obs: FaceObservation,
  motionState: MotionSourceState,
): { signals: DerivedSignals; nextMotionState: MotionSourceState } {
  const { motionActive, nextState } = deriveMotion(obs, motionState);
  return {
    signals: {
      faceVisible: obs.faceCount > 0,
      gazeAtScreen: deriveGazeAtScreen(obs),
      motionActive,
    },
    nextMotionState: nextState,
  };
}
