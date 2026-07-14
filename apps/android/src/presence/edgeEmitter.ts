import type { DerivedSignals } from './signalDeriver.js';

export interface EmittedEdges {
  faceVisible?: boolean;
  gazeAtScreen?: boolean;
  motionActive?: boolean;
}

type SignalKey = 'faceVisible' | 'gazeAtScreen' | 'motionActive';
const KEYS: SignalKey[] = ['faceVisible', 'gazeAtScreen', 'motionActive'];

export interface EdgeEmitterState {
  lastEmitted: Record<SignalKey, boolean> | null;
  lastEmitAtMs: Record<SignalKey, number>;
}

export const INITIAL_EDGE_EMITTER_STATE: EdgeEmitterState = {
  lastEmitted: null,
  lastEmitAtMs: { faceVisible: -Infinity, gazeAtScreen: -Infinity, motionActive: -Infinity },
};

export function deriveEdges(
  signals: DerivedSignals,
  state: EdgeEmitterState,
  nowMs: number,
  minDwellMs: number,
): { edges: EmittedEdges; nextState: EdgeEmitterState } {
  const edges: EmittedEdges = {};
  const nextLastEmitted: Record<SignalKey, boolean> = state.lastEmitted
    ? { ...state.lastEmitted }
    : { faceVisible: signals.faceVisible, gazeAtScreen: signals.gazeAtScreen, motionActive: signals.motionActive };
  const nextLastEmitAtMs = { ...state.lastEmitAtMs };

  for (const key of KEYS) {
    const value = signals[key];
    const isFirstObservation = state.lastEmitted === null;
    const changed = isFirstObservation || state.lastEmitted![key] !== value;
    if (!changed) continue;
    const dwellOk = nowMs - state.lastEmitAtMs[key] >= minDwellMs;
    if (!dwellOk) continue;
    edges[key] = value;
    nextLastEmitted[key] = value;
    nextLastEmitAtMs[key] = nowMs;
  }

  return { edges, nextState: { lastEmitted: nextLastEmitted, lastEmitAtMs: nextLastEmitAtMs } };
}
