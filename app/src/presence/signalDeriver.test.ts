import { describe, it, expect } from 'vitest';
import { deriveGazeAtScreen, deriveMotion, deriveSignals } from './signalDeriver.js';

describe('deriveGazeAtScreen', () => {
  it('is true for a frontal face with an open eye', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 0, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 })).toBe(true);
  });

  it('is false with no face', () => {
    expect(deriveGazeAtScreen({ faceCount: 0 })).toBe(false);
  });

  it('is true just inside the yaw threshold (17deg)', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 17, leftEyeOpenProbability: 0.9 })).toBe(true);
  });

  it('is false just outside the yaw threshold (19deg), matching MLKit\'s ~18deg reliability ceiling', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 19, leftEyeOpenProbability: 0.9 })).toBe(false);
  });

  it('is false when both eye-open probabilities are unavailable (fails closed)', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 0 })).toBe(false);
  });

  it('is true when only one eye probability is available and open', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 0, rightEyeOpenProbability: 0.9 })).toBe(true);
  });

  it('is false when the available eye probability is below the open threshold', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 0, leftEyeOpenProbability: 0.2 })).toBe(false);
  });

  it('is false when both eyes report MLKit\'s -1 "uncomputable" sentinel (treated the same as unavailable)', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 0, leftEyeOpenProbability: -1, rightEyeOpenProbability: -1 })).toBe(false);
  });

  it('is true when one eye is a real open reading and the other reports -1 (uncomputable does not veto a real reading)', () => {
    expect(deriveGazeAtScreen({ faceCount: 1, eulerX: 0, eulerY: 0, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: -1 })).toBe(true);
  });
});

describe('deriveMotion', () => {
  it('reports motion when a face appears from none', () => {
    expect(deriveMotion({ faceCount: 1 }, { prevFaceCount: 0 }).motionActive).toBe(true);
  });

  it('reports motion when a face disappears', () => {
    expect(deriveMotion({ faceCount: 0 }, { prevFaceCount: 1 }).motionActive).toBe(true);
  });

  it('reports motion when the bbox centroid shifts beyond threshold', () => {
    const prev = { prevFaceCount: 1, prevBbox: { x: 0, y: 0, width: 0.2, height: 0.2 } };
    const { motionActive } = deriveMotion({ faceCount: 1, bbox: { x: 0.2, y: 0, width: 0.2, height: 0.2 } }, prev);
    expect(motionActive).toBe(true);
  });

  it('reports no motion for a stable bbox', () => {
    const prev = { prevFaceCount: 1, prevBbox: { x: 0, y: 0, width: 0.2, height: 0.2 } };
    const { motionActive } = deriveMotion({ faceCount: 1, bbox: { x: 0.001, y: 0, width: 0.2, height: 0.2 } }, prev);
    expect(motionActive).toBe(false);
  });

  it('threads bbox and face count state forward for the next call', () => {
    const { nextState } = deriveMotion({ faceCount: 1, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }, { prevFaceCount: 0 });
    expect(nextState).toEqual({ prevFaceCount: 1, prevBbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } });
  });
});

describe('deriveSignals', () => {
  it('composes faceVisible, gazeAtScreen, and motionActive, and threads motion state forward', () => {
    const result = deriveSignals(
      { faceCount: 1, eulerX: 0, eulerY: 0, leftEyeOpenProbability: 0.9, bbox: { x: 0, y: 0, width: 0.2, height: 0.2 } },
      { prevFaceCount: 0 },
    );
    expect(result.signals).toEqual({ faceVisible: true, gazeAtScreen: true, motionActive: true });
    expect(result.nextMotionState).toEqual({ prevFaceCount: 1, prevBbox: { x: 0, y: 0, width: 0.2, height: 0.2 } });
  });

  it('reports all-false signals for an empty observation with no prior state', () => {
    const result = deriveSignals({ faceCount: 0 }, { prevFaceCount: 0 });
    expect(result.signals).toEqual({ faceVisible: false, gazeAtScreen: false, motionActive: false });
  });
});
