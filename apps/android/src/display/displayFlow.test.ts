import { describe, it, expect } from 'vitest';
import {
  INITIAL_DISPLAY_FLOW,
  DISPLAY_REPLY_TIMEOUT_MS,
  DISPLAY_MEASURE_TIMEOUT_MS,
  reduceDisplayFlow,
  displayReasonCopy,
  isStaleDisplayReply,
  noteDisplaySessionSeen,
  type SeenDisplaySessions,
  type DisplayFlowState,
  type DisplayFlowEvent,
  type DisplaySize,
} from './displayFlow.js';

const size: DisplaySize = { w: 2400, h: 1080, orientation: 'landscape' };
const requesting = (requestedAt = 1000): DisplayFlowState => ({ phase: 'requesting', size, requestedAt });
const starting = (sessionId = 's1'): DisplayFlowState => ({ phase: 'starting', sessionId });
const streaming = (sessionId = 's1'): DisplayFlowState => ({ phase: 'streaming', sessionId, inputEnabled: true });
const reply = (payload: Extract<DisplayFlowEvent, { type: 'sessionReply' }>['payload'], stale = false): DisplayFlowEvent => ({
  type: 'sessionReply',
  payload,
  stale,
});

describe('displayFlow', () => {
  it('starts in measuring and the timeout is 12000', () => {
    expect(INITIAL_DISPLAY_FLOW).toEqual({ phase: 'measuring' });
    expect(DISPLAY_REPLY_TIMEOUT_MS).toBe(12000);
  });

  it('requests start on the first surface size when the link is up', () => {
    const r = reduceDisplayFlow(INITIAL_DISPLAY_FLOW, { type: 'surfaceSize', size, linkConnected: true, now: 1000 });
    expect(r.state).toEqual({ phase: 'requesting', size, requestedAt: 1000 });
    expect(r.effects).toEqual([{ kind: 'sendStart', size }]);
  });

  it('fails immediately when the JSON link is down', () => {
    const r = reduceDisplayFlow(INITIAL_DISPLAY_FLOW, { type: 'surfaceSize', size, linkConnected: false, now: 1000 });
    expect(r.state).toEqual({ phase: 'failed', reason: 'mac-not-connected' });
    expect(r.effects).toEqual([]);
  });

  it('ignores later surface sizes once requested (rotation is native)', () => {
    const r = reduceDisplayFlow(requesting(), { type: 'surfaceSize', size: { ...size, w: 1080, h: 2400, orientation: 'portrait' }, linkConnected: true, now: 2000 });
    expect(r.state).toEqual(requesting());
    expect(r.effects).toEqual([]);
    const r2 = reduceDisplayFlow(streaming(), { type: 'surfaceSize', size, linkConnected: true, now: 2000 });
    expect(r2.state).toEqual(streaming());
    expect(r2.effects).toEqual([]);
  });

  it('starts native on a ready reply', () => {
    const r = reduceDisplayFlow(requesting(), reply({ state: 'ready', sessionId: 's1', videoPort: 8788 }));
    expect(r.state).toEqual({ phase: 'starting', sessionId: 's1' });
    expect(r.effects).toEqual([{ kind: 'nativeStart', sessionId: 's1', videoPort: 8788 }]);
  });

  it('ignores a ready without a sessionId and still adopts a later valid ready', () => {
    const s = requesting();
    const r = reduceDisplayFlow(s, reply({ state: 'ready', sessionId: null, videoPort: 8788 }));
    expect(r.state).toEqual(s);
    expect(r.effects).toEqual([]);
    const r2 = reduceDisplayFlow(r.state, reply({ state: 'ready', sessionId: 's1', videoPort: 8788 }));
    expect(r2.state).toEqual({ phase: 'starting', sessionId: 's1' });
    expect(r2.effects).toEqual([{ kind: 'nativeStart', sessionId: 's1', videoPort: 8788 }]);
  });

  it('accepts a duplicate ready for the same session as a no-op', () => {
    for (const s of [starting(), streaming()]) {
      const r = reduceDisplayFlow(s, reply({ state: 'ready', sessionId: 's1', videoPort: 8788 }));
      expect(r.state).toEqual(s);
      expect(r.effects).toEqual([]);
    }
  });

  it('fails with the reply reason on an error reply (null sessionId accepted)', () => {
    const r = reduceDisplayFlow(requesting(), reply({ state: 'error', sessionId: null, reason: 'unsupported' }));
    expect(r.state).toEqual({ phase: 'failed', reason: 'unsupported' });
    expect(r.effects).toEqual([]);
  });

  it('adopts the first reply whatever its sessionId while requesting', () => {
    const r = reduceDisplayFlow(requesting(), reply({ state: 'error', sessionId: 'other', reason: 'no-device' }));
    expect(r.state).toEqual({ phase: 'failed', reason: 'no-device' });
    const r2 = reduceDisplayFlow(requesting(), reply({ state: 'ready', sessionId: 'zzz', videoPort: 8788 }));
    expect(r2.state).toEqual({ phase: 'starting', sessionId: 'zzz' });
  });

  it('adopts an ended reply while requesting as a failure with its reason and no native start', () => {
    const r = reduceDisplayFlow(requesting(), reply({ state: 'ended', sessionId: null, reason: 'stop-requested' }));
    expect(r.state).toEqual({ phase: 'failed', reason: 'stop-requested' });
    expect(r.effects).toEqual([]);
  });

  it('ignores a stale ended reply while requesting, then adopts a later fresh ready', () => {
    const r = reduceDisplayFlow(requesting(), reply({ state: 'ended', sessionId: 'A', reason: 'token-timeout' }, true));
    expect(r.state).toEqual(requesting());
    expect(r.effects).toEqual([]);
    const r2 = reduceDisplayFlow(r.state, reply({ state: 'ready', sessionId: 'B', videoPort: 8788 }, false));
    expect(r2.state).toEqual({ phase: 'starting', sessionId: 'B' });
    expect(r2.effects).toEqual([{ kind: 'nativeStart', sessionId: 'B', videoPort: 8788 }]);
  });

  it('ignores stale error and ready replies while requesting too', () => {
    expect(reduceDisplayFlow(requesting(), reply({ state: 'error', sessionId: 'A', reason: 'helper-crashed' }, true)).state).toEqual(requesting());
    expect(reduceDisplayFlow(requesting(), reply({ state: 'ready', sessionId: 'A', videoPort: 8788 }, true)).state).toEqual(requesting());
  });

  it('a stale flag on a null-sessionId reply is not trusted (it is still adopted)', () => {
    const r = reduceDisplayFlow(requesting(), reply({ state: 'error', sessionId: null, reason: 'no-device' }, true));
    expect(r.state).toEqual({ phase: 'failed', reason: 'no-device' });
  });

  it('seen-session bookkeeping: stale iff first seen at or before the frame seq current when display.start was sent', () => {
    const seen: SeenDisplaySessions = new Map();
    noteDisplaySessionSeen(seen, 'A', 1); // an earlier visit's session
    const startSeq = 1; // this screen sent display.start with the counter at 1
    expect(isStaleDisplayReply(seen, 'A', startSeq)).toBe(true);
    // B first seen after the start: never stale, even judged from a later frame
    noteDisplaySessionSeen(seen, 'B', 2);
    expect(isStaleDisplayReply(seen, 'B', startSeq)).toBe(false);
    // the first sighting wins
    noteDisplaySessionSeen(seen, 'B', 7);
    expect(seen.get('B')).toBe(2);
    noteDisplaySessionSeen(seen, null, 3);
    expect(seen.size).toBe(2);
    expect(isStaleDisplayReply(seen, null, startSeq)).toBe(false);
    expect(isStaleDisplayReply(seen, 'C', startSeq)).toBe(false);
    // no start sent yet: nothing is pending, nothing is stale
    expect(isStaleDisplayReply(seen, 'A', null)).toBe(false);
  });

  it('ignores an ended/superseded reply while requesting', () => {
    const r = reduceDisplayFlow(requesting(), reply({ state: 'ended', sessionId: 'old', reason: 'superseded' }));
    expect(r.state).toEqual(requesting());
    expect(r.effects).toEqual([]);
    const r2 = reduceDisplayFlow(requesting(), reply({ state: 'ended', sessionId: null, reason: 'superseded' }));
    expect(r2.state).toEqual(requesting());
  });

  it('times out after 12000ms and tells core to stop', () => {
    const at = requesting(1000);
    expect(reduceDisplayFlow(at, { type: 'tick', now: 1000 + 12000 }).effects).toEqual([]);
    const r = reduceDisplayFlow(at, { type: 'tick', now: 1000 + 12001 });
    expect(r.state).toEqual({ phase: 'failed', reason: 'reply-timeout' });
    expect(r.effects).toEqual([{ kind: 'sendStop', sessionId: null, reason: 'reply-timeout' }]);
  });

  it('fails with surface-unavailable when no surface size arrives within 3000 ms of the first tick', () => {
    expect(DISPLAY_MEASURE_TIMEOUT_MS).toBe(3000);
    const first = reduceDisplayFlow(INITIAL_DISPLAY_FLOW, { type: 'tick', now: 5000 });
    expect(first.state).toEqual({ phase: 'measuring', measuringSince: 5000 });
    expect(first.effects).toEqual([]);
    const edge = reduceDisplayFlow(first.state, { type: 'tick', now: 5000 + 3000 });
    expect(edge.state).toEqual(first.state);
    const over = reduceDisplayFlow(first.state, { type: 'tick', now: 5000 + 3001 });
    expect(over.state).toEqual({ phase: 'failed', reason: 'surface-unavailable' });
    expect(over.effects).toEqual([]);
  });

  it('still requests start from measuring after ticks have begun', () => {
    const r = reduceDisplayFlow({ phase: 'measuring', measuringSince: 5000 }, { type: 'surfaceSize', size, linkConnected: true, now: 6000 });
    expect(r.state).toEqual({ phase: 'requesting', size, requestedAt: 6000 });
  });

  it('has copy for surface-unavailable', () => {
    expect(displayReasonCopy('surface-unavailable')).toBe("The phone screen couldn't be prepared — try again");
  });

  it('ignores ticks outside requesting', () => {
    for (const s of [starting(), streaming(), { phase: 'failed', reason: 'x' } as DisplayFlowState]) {
      const r = reduceDisplayFlow(s, { type: 'tick', now: 10_000_000 });
      expect(r.state).toEqual(s);
      expect(r.effects).toEqual([]);
    }
  });

  it('does not exit when the JSON link drops mid-session', () => {
    const r = reduceDisplayFlow(streaming(), { type: 'jsonLinkChanged', connected: false });
    expect(r.state).toEqual(streaming());
    expect(r.effects).toEqual([]);
  });

  it('user exit stops native and core and goes home', () => {
    const r = reduceDisplayFlow(streaming(), { type: 'userExit' });
    expect(r.state).toEqual({ phase: 'exited', reason: 'user-exit' });
    expect(r.effects).toEqual([{ kind: 'nativeStop' }, { kind: 'sendStop', sessionId: 's1', reason: 'user-exit' }, { kind: 'goHome' }]);
    const r2 = reduceDisplayFlow(starting(), { type: 'userExit' });
    expect(r2.effects).toEqual([{ kind: 'nativeStop' }, { kind: 'sendStop', sessionId: 's1', reason: 'user-exit' }, { kind: 'goHome' }]);
  });

  it('user exit while requesting cancels the pending start and goes home', () => {
    const r = reduceDisplayFlow(requesting(), { type: 'userExit' });
    expect(r.state.phase).toBe('exited');
    expect(r.effects).toEqual([{ kind: 'sendStop', sessionId: null, reason: 'user-exit' }, { kind: 'goHome' }]);
  });

  it('user exit while failed or measuring only goes home', () => {
    const r = reduceDisplayFlow({ phase: 'failed', reason: 'unsupported' }, { type: 'userExit' });
    expect(r.state.phase).toBe('exited');
    expect(r.effects).toEqual([{ kind: 'goHome' }]);
    const r2 = reduceDisplayFlow(INITIAL_DISPLAY_FLOW, { type: 'userExit' });
    expect(r2.state.phase).toBe('exited');
    expect(r2.effects).toEqual([{ kind: 'goHome' }]);
  });

  it('native streaming reaches streaming with inputEnabled; paused keeps streaming', () => {
    const r = reduceDisplayFlow(starting(), { type: 'nativeState', state: 'streaming', inputEnabled: true });
    expect(r.state).toEqual({ phase: 'streaming', sessionId: 's1', inputEnabled: true });
    const r0 = reduceDisplayFlow(starting(), { type: 'nativeState', state: 'streaming' });
    expect(r0.state).toEqual({ phase: 'streaming', sessionId: 's1', inputEnabled: false });
    const p = reduceDisplayFlow(r.state, { type: 'nativeState', state: 'paused' });
    expect(p.state).toEqual(r.state);
    expect(p.effects).toEqual([]);
    const c = reduceDisplayFlow(starting(), { type: 'nativeState', state: 'connecting' });
    expect(c.state).toEqual(starting());
  });

  it('native ended goes home; native error shows failure', () => {
    const e = reduceDisplayFlow(streaming(), { type: 'nativeState', state: 'ended', reason: 'watchdog' });
    expect(e.state).toEqual({ phase: 'exited', reason: 'watchdog' });
    expect(e.effects).toEqual([{ kind: 'goHome' }]);
    const f = reduceDisplayFlow(starting(), { type: 'nativeState', state: 'error', reason: 'decoder-error' });
    expect(f.state).toEqual({ phase: 'failed', reason: 'decoder-error' });
  });

  it('a native error tells core to stop the session', () => {
    const r = reduceDisplayFlow(streaming(), { type: 'nativeState', state: 'error', reason: 'connect-failed' });
    expect(r.effects).toEqual([{ kind: 'sendStop', sessionId: 's1', reason: 'connect-failed' }]);
    const r2 = reduceDisplayFlow(streaming(), { type: 'nativeState', state: 'error' });
    expect(r2.effects).toEqual([{ kind: 'sendStop', sessionId: 's1' }]);
  });

  it('forwards the sendStop reason only when it is a DisplayReason', () => {
    const r = reduceDisplayFlow(streaming(), { type: 'nativeState', state: 'error', reason: 'some-kotlin-thing' });
    expect(r.state).toEqual({ phase: 'failed', reason: 'some-kotlin-thing' });
    expect(r.effects).toEqual([{ kind: 'sendStop', sessionId: 's1' }]);
    expect('reason' in (r.effects[0] as object)).toBe(false);
  });

  it('ignores replies for other sessions once started', () => {
    for (const s of [starting(), streaming()]) {
      for (const payload of [
        { state: 'ended' as const, sessionId: 's2', reason: 'stop-requested' },
        { state: 'error' as const, sessionId: 's2', reason: 'helper-crashed' },
        { state: 'ready' as const, sessionId: 's2', videoPort: 8788 },
        { state: 'error' as const, sessionId: null, reason: 'no-device' },
      ]) {
        const r = reduceDisplayFlow(s, reply(payload));
        expect(r.state).toEqual(s);
        expect(r.effects).toEqual([]);
      }
    }
  });

  it('a core ended reply for the current session stops native and goes home', () => {
    const r = reduceDisplayFlow(streaming(), reply({ state: 'ended', sessionId: 's1', reason: 'stop-requested' }));
    expect(r.state).toEqual({ phase: 'exited', reason: 'stop-requested' });
    expect(r.effects).toEqual([{ kind: 'nativeStop' }, { kind: 'goHome' }]);
  });

  it('a core error reply mid-session stops native and shows the failure', () => {
    const r = reduceDisplayFlow(streaming(), reply({ state: 'error', sessionId: 's1', reason: 'helper-crashed' }));
    expect(r.state).toEqual({ phase: 'failed', reason: 'helper-crashed' });
    expect(r.effects).toEqual([{ kind: 'nativeStop' }]);
  });

  it('maps reasons to copy', () => {
    expect(displayReasonCopy('unsupported')).toBe('Not supported on this Mac');
    expect(displayReasonCopy('permission-screen-recording')).toBe('Allow Screen Recording for Desk Agent on your Mac');
    expect(displayReasonCopy('no-device')).toBe('Phone not detected over USB on the Mac');
    expect(displayReasonCopy('mac-not-connected')).toBe('Mac not connected');
    expect(displayReasonCopy('token-timeout')).toBe("Couldn't get the session key from the Mac");
    expect(displayReasonCopy('reply-timeout')).toBe("The Mac didn't answer — update Desk Agent on the Mac?");
    expect(displayReasonCopy('version-mismatch')).toBe('Update Desk Agent on the Mac and phone');
    expect(displayReasonCopy('protocol-error')).toBe('Update Desk Agent on the Mac and phone');
    expect(displayReasonCopy('capture-unavailable')).toBe("The Mac can't capture the display — check Screen Recording for Desk Agent");
    expect(displayReasonCopy('connect-failed')).toBe("Couldn't connect to the Mac's display — try again");
    expect(displayReasonCopy('display-offline')).toBe('Desk Agent Phone is switched off on the Mac — turn it on in Control Center › Display while it connects');
    expect(displayReasonCopy('mac-asleep')).toBe("The Mac's screen is asleep — wake and unlock it, then try again");
    expect(displayReasonCopy('whatever')).toBe('Display ended');
  });
});
