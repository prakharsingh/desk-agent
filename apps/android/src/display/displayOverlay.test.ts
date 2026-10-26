import { describe, it, expect } from 'vitest';
import {
  INITIAL_HINT,
  PLACEMENT_HINT_MS,
  asPlacementSide,
  hintOnFlow,
  hintTicked,
  placementHintCopy,
  INITIAL_ROTATE,
  ROTATE_INDICATOR_TIMEOUT_MS,
  ROTATE_LABEL,
  ROTATING_COPY,
  TOUCH_OFF_BANNER,
  rotateButtonVisible,
  rotateEnded,
  rotateStreamed,
  rotateTap,
  rotateTicked,
  touchBannerVisible,
} from './displayOverlay.js';
import { reduceDisplayFlow, type DisplayFlowState } from './displayFlow.js';

const streaming = (inputEnabled: boolean): DisplayFlowState => ({ phase: 'streaming', sessionId: 's1', inputEnabled });

describe('touch banner', () => {
  it('shows only while streaming with input off', () => {
    expect(touchBannerVisible(streaming(false))).toBe(true);
    expect(touchBannerVisible(streaming(true))).toBe(false);
    expect(touchBannerVisible({ phase: 'starting', sessionId: 's1' })).toBe(false);
    expect(touchBannerVisible({ phase: 'measuring' })).toBe(false);
    expect(touchBannerVisible({ phase: 'failed', reason: 'x' })).toBe(false);
  });

  it('hides as soon as input turns on mid-session (native re-emits streaming)', () => {
    const r = reduceDisplayFlow(streaming(false), { type: 'nativeState', state: 'streaming', inputEnabled: true });
    expect(r.state).toEqual(streaming(true));
    expect(r.effects).toEqual([]);
    expect(touchBannerVisible(r.state)).toBe(false);
  });

  it('shows again when input is revoked mid-session', () => {
    const r = reduceDisplayFlow(streaming(true), { type: 'nativeState', state: 'streaming', inputEnabled: false });
    expect(touchBannerVisible(r.state)).toBe(true);
  });

  it('uses the agreed copy', () => {
    expect(TOUCH_OFF_BANNER).toBe("Touch is off — allow Desk Agent in Accessibility on the Mac, then reconnect if touch doesn't start");
  });
});

describe('rotate control', () => {
  it('a tap asks for the other orientation and shows Rotating…', () => {
    const r = rotateTap(INITIAL_ROTATE, 'portrait', 1000);
    expect(r.request).toBe('landscape');
    expect(r.state).toEqual({ locked: 'landscape', rotatingTo: 'landscape', since: 1000 });
    expect(rotateTap(INITIAL_ROTATE, 'landscape', 0).request).toBe('portrait');
  });

  it('a second tap while still rotating toggles from the pending target, not the old surface', () => {
    const first = rotateTap(INITIAL_ROTATE, 'portrait', 1000);
    const second = rotateTap(first.state, 'portrait', 1500);
    expect(second.request).toBe('portrait');
    expect(second.state.rotatingTo).toBe('portrait');
  });

  it('Rotating… clears once the stream arrives in the target orientation', () => {
    const { state } = rotateTap(INITIAL_ROTATE, 'portrait', 1000);
    expect(rotateStreamed(state, 'portrait')).toBe(state); // the old stream still
    const done = rotateStreamed(state, 'landscape');
    expect(done.rotatingTo).toBeNull();
    expect(done.locked).toBe('landscape'); // the choice is kept for the session
  });

  it('Rotating… gives up after the timeout so it never sticks', () => {
    const { state } = rotateTap(INITIAL_ROTATE, 'portrait', 1000);
    expect(rotateTicked(state, 1000 + ROTATE_INDICATOR_TIMEOUT_MS)).toBe(state);
    expect(rotateTicked(state, 1001 + ROTATE_INDICATOR_TIMEOUT_MS).rotatingTo).toBeNull();
    expect(rotateTicked(INITIAL_ROTATE, 99999)).toBe(INITIAL_ROTATE);
  });

  it('the session end restores auto-rotate only when the user picked an orientation', () => {
    const { state } = rotateTap(INITIAL_ROTATE, 'portrait', 1000);
    expect(rotateEnded(state)).toEqual({ state: INITIAL_ROTATE, restore: true });
    expect(rotateEnded(INITIAL_ROTATE)).toEqual({ state: INITIAL_ROTATE, restore: false });
  });

  it('is offered only while streaming', () => {
    expect(rotateButtonVisible(streaming(true))).toBe(true);
    expect(rotateButtonVisible({ phase: 'starting', sessionId: 's1' })).toBe(false);
    expect(rotateButtonVisible({ phase: 'measuring' })).toBe(false);
  });

  it('uses the agreed copy', () => {
    expect(ROTATING_COPY).toBe('Rotating…');
    expect(ROTATE_LABEL).toBe('Rotate display');
  });
});

describe('placement hint', () => {
  it('names the edge of the main screen from the real arrangement', () => {
    expect(placementHintCopy('left', 'landscape')).toBe('Drag a window off the left edge of your main screen to move it here.');
    expect(placementHintCopy('right', 'landscape')).toBe('Drag a window off the right edge of your main screen to move it here.');
    expect(placementHintCopy('above', 'landscape')).toBe('Drag a window off the top edge of your main screen to move it here.');
    expect(placementHintCopy('below', 'landscape')).toBe('Drag a window off the bottom edge of your main screen to move it here.');
  });

  it('falls back to a generic line when the Mac does not say (older helper, or no clear side)', () => {
    expect(placementHintCopy(undefined, 'landscape')).toBe('Drag a window from your main screen onto Desk Agent Phone to move it here.');
  });

  it('adds the landscape tip in portrait', () => {
    expect(placementHintCopy('left', 'portrait')).toBe(
      'Drag a window off the left edge of your main screen to move it here. Wide apps fit better in landscape — tap ⟳',
    );
  });

  it('shows once per session when streaming starts and auto-hides after about 8 s', () => {
    const s1 = streaming(true) as Extract<DisplayFlowState, { phase: 'streaming' }>;
    const shown = hintOnFlow(INITIAL_HINT, s1, 1000);
    expect(shown).toEqual({ sessionId: 's1', visible: true, until: 1000 + PLACEMENT_HINT_MS });
    expect(PLACEMENT_HINT_MS).toBe(8000);
    expect(hintOnFlow(shown, s1, 2000)).toBe(shown); // the same session: no restart
    expect(hintTicked(shown, 1000 + PLACEMENT_HINT_MS)).toBe(shown);
    const hidden = hintTicked(shown, 1001 + PLACEMENT_HINT_MS);
    expect(hidden.visible).toBe(false);
    // Input turning on mid-session re-emits streaming for the same session: the hint stays gone.
    expect(hintOnFlow(hidden, { ...s1, inputEnabled: false }, 20000)).toBe(hidden);
    // A new session shows it again.
    expect(hintOnFlow(hidden, { ...s1, sessionId: 's2' }, 30000).visible).toBe(true);
  });

  it('accepts only the four known sides from native', () => {
    expect(asPlacementSide('above')).toBe('above');
    expect(asPlacementSide('diagonal')).toBeUndefined();
    expect(asPlacementSide(undefined)).toBeUndefined();
    expect(asPlacementSide(3)).toBeUndefined();
  });

  it('never shows before streaming', () => {
    expect(hintOnFlow(INITIAL_HINT, { phase: 'starting', sessionId: 's1' }, 0)).toBe(INITIAL_HINT);
  });

  it('the flow keeps the side the native streaming state reports', () => {
    const r = reduceDisplayFlow({ phase: 'starting', sessionId: 's1' }, { type: 'nativeState', state: 'streaming', inputEnabled: false, side: 'left' });
    expect(r.state).toEqual({ phase: 'streaming', sessionId: 's1', inputEnabled: false, side: 'left' });
    const plain = reduceDisplayFlow({ phase: 'starting', sessionId: 's1' }, { type: 'nativeState', state: 'streaming', inputEnabled: true });
    expect(plain.state).toEqual({ phase: 'streaming', sessionId: 's1', inputEnabled: true });
    expect('side' in plain.state).toBe(false);
  });
});
