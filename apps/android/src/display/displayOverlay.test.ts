import { describe, it, expect } from 'vitest';
import { TOUCH_OFF_BANNER, touchBannerVisible } from './displayOverlay.js';
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
