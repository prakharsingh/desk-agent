import type { DisplayOrientation } from '@desk-agent/protocol';
import type { DisplayFlowState } from './displayFlow.js';

// Small, non-blocking hints drawn over the live display stream (DisplayScreen).
//
// Every one of them lives in an always-mounted, fixed-size slot that is mounted together with the display
// SurfaceView and only toggles its opacity. The SurfaceView punches a hole in the activity window that is only
// recomputed on a root layout (the window size changing, e.g. a rotation); RN never triggers one, so a view
// mounted later over the video is composited away (F1). A slot that was laid out when the hole was computed
// keeps its rectangle composited, so showing it later works.

/** Persistent banner while the Mac has not granted Accessibility (touch input is off). */
// Touch may only start after a reconnect (an older phone app, or a helper that cannot see the grant mid-session).
export const TOUCH_OFF_BANNER = "Touch is off — allow Desk Agent in Accessibility on the Mac, then reconnect if touch doesn't start";

/** The banner shows whenever input is off during a live session, and hides as soon as it turns on. */
export function touchBannerVisible(flow: DisplayFlowState): boolean {
  return flow.phase === 'streaming' && !flow.inputEnabled;
}

// ---- Rotate control ----
//
// Android does not auto-rotate a phone that is docked or lying flat, so the display screen offers a small rotate
// button. A tap pins the activity's requested orientation to the other one (portrait <-> landscape); the surface
// reports its new size and the Mac switches the display mode (about 1.7 s), as for a physical rotation.
// Interaction with auto-rotate (decided): once the user taps it, the chosen orientation is kept for the rest of
// the session and the sensor is ignored; when the session ends (or the screen is left) the requested orientation
// goes back to unspecified, i.e. the sensor and the user's auto-rotate setting. A session in which the user never
// tapped it never touches the orientation.

export const ROTATE_LABEL = 'Rotate display';
export const ROTATING_COPY = 'Rotating…';
/** "Rotating…" never outlives this, e.g. when the Mac keeps the old mode (mirrored display, failed switch). */
export const ROTATE_INDICATOR_TIMEOUT_MS = 6000;

export type RotateState = {
  /** The orientation the user pinned this session, or null while it follows the sensor. */
  locked: DisplayOrientation | null;
  /** Shown as "Rotating…" until the stream arrives in this orientation. */
  rotatingTo: DisplayOrientation | null;
  since: number;
};

export const INITIAL_ROTATE: RotateState = { locked: null, rotatingTo: null, since: 0 };

const other = (o: DisplayOrientation): DisplayOrientation => (o === 'portrait' ? 'landscape' : 'portrait');

export function rotateButtonVisible(flow: DisplayFlowState): boolean {
  return flow.phase === 'streaming';
}

/** `current`: the surface's orientation now. A tap while still rotating toggles from the pending target. */
export function rotateTap(state: RotateState, current: DisplayOrientation, now: number): { state: RotateState; request: DisplayOrientation } {
  const request = other(state.rotatingTo ?? current);
  return { state: { locked: request, rotatingTo: request, since: now }, request };
}

/** The Mac now streams in `orientation` (DisplayStreamSize). */
export function rotateStreamed(state: RotateState, orientation: DisplayOrientation): RotateState {
  return state.rotatingTo === orientation ? { ...state, rotatingTo: null } : state;
}

export function rotateTicked(state: RotateState, now: number): RotateState {
  return state.rotatingTo !== null && now - state.since > ROTATE_INDICATOR_TIMEOUT_MS ? { ...state, rotatingTo: null } : state;
}

/** The session ended: `restore` = hand the orientation back to the sensor (only if the user pinned one). */
export function rotateEnded(state: RotateState): { state: RotateState; restore: boolean } {
  return { state: INITIAL_ROTATE, restore: state.locked !== null };
}
