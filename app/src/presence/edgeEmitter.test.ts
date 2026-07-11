import { describe, it, expect } from 'vitest';
import { deriveEdges, INITIAL_EDGE_EMITTER_STATE } from './edgeEmitter.js';

describe('deriveEdges', () => {
  it('emits all three signals on the very first observation', () => {
    const { edges } = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: true }, INITIAL_EDGE_EMITTER_STATE, 0, 1000);
    expect(edges).toEqual({ faceVisible: true, gazeAtScreen: false, motionActive: true });
  });

  it('emits nothing when nothing changed', () => {
    const first = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: false }, INITIAL_EDGE_EMITTER_STATE, 0, 1000);
    const second = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: false }, first.nextState, 500, 1000);
    expect(second.edges).toEqual({});
  });

  it('emits only the changed signal on a real transition past the dwell window', () => {
    const first = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: false }, INITIAL_EDGE_EMITTER_STATE, 0, 1000);
    const second = deriveEdges({ faceVisible: false, gazeAtScreen: false, motionActive: false }, first.nextState, 2000, 1000);
    expect(second.edges).toEqual({ faceVisible: false });
  });

  it('collapses rapid flapping within the dwell window to a single emission', () => {
    let state = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: false }, INITIAL_EDGE_EMITTER_STATE, 0, 1000).nextState;
    state = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: true }, state, 100, 1000).nextState;
    let result = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: false }, state, 300, 1000);
    expect(result.edges).toEqual({});
    result = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: true }, result.nextState, 600, 1000);
    expect(result.edges).toEqual({});
    result = deriveEdges({ faceVisible: true, gazeAtScreen: false, motionActive: true }, result.nextState, 1100, 1000);
    expect(result.edges).toEqual({ motionActive: true });
  });
});
