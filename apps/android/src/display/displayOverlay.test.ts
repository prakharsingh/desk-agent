import { describe, it, expect } from 'vitest';
import {
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
