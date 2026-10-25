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
