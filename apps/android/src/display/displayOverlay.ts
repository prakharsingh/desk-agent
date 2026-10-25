import type { DisplayOrientation } from '@desk-agent/protocol';
import type { DisplayFlowState, PlacementSide } from './displayFlow.js';

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

// ---- Placement hint ----
//
// macOS 27 has no Window › "Move to Desk Agent Phone" item (user report 3): a window gets here by being dragged
// off the edge of the main screen where Desk Agent Phone is arranged. The helper reports that side in helloAck;
// the phone shows it once per session, as soon as the stream is live, for PLACEMENT_HINT_MS. It never takes
// touches (a tap on it reaches the Mac), so it is not tap-dismissible; it only auto-hides.

export type { PlacementSide } from './displayFlow.js';

export const PLACEMENT_HINT_MS = 8000;

const SIDES: readonly string[] = ['left', 'right', 'above', 'below'];

/** The native event's side, if it is one we know (anything else gets the generic hint). */
export function asPlacementSide(v: unknown): PlacementSide | undefined {
  return typeof v === 'string' && SIDES.includes(v) ? (v as PlacementSide) : undefined;
}

const EDGE: Record<PlacementSide, string> = { left: 'left', right: 'right', above: 'top', below: 'bottom' };
const PORTRAIT_TIP = ' Wide apps fit better in landscape — tap ⟳';

export function placementHintCopy(side: PlacementSide | undefined, orientation: DisplayOrientation): string {
  const line =
    side === undefined
      ? 'Drag a window from your main screen onto Desk Agent Phone to move it here.'
      : `Drag a window off the ${EDGE[side]} edge of your main screen to move it here.`;
  return orientation === 'portrait' ? line + PORTRAIT_TIP : line;
}

export type HintState = { sessionId: string | null; visible: boolean; until: number };

export const INITIAL_HINT: HintState = { sessionId: null, visible: false, until: 0 };

/** Shows the hint the first time `flow` streams a session; every later streaming state of it changes nothing. */
export function hintOnFlow(hint: HintState, flow: DisplayFlowState, now: number): HintState {
  if (flow.phase !== 'streaming' || flow.sessionId === hint.sessionId) return hint;
  return { sessionId: flow.sessionId, visible: true, until: now + PLACEMENT_HINT_MS };
}

export function hintTicked(hint: HintState, now: number): HintState {
  return hint.visible && now > hint.until ? { ...hint, visible: false } : hint;
}
