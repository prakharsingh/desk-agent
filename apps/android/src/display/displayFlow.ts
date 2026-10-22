import {
  DISPLAY_REASONS,
  DISPLAY_VIDEO_PORT,
  type DisplayOrientation,
  type DisplayReason,
  type DisplaySessionPayload,
} from '@desk-agent/protocol';

// >= helper spawn + VD create + SC_APPEAR_TIMEOUT_MS (5 s) + adb reverse + broadcast, with margin.
export const DISPLAY_REPLY_TIMEOUT_MS = 12000;

// The native surface normally reports its size within a frame or two; if it never does
// (event missed, view never mounted) the flow fails instead of sitting in `measuring`.
export const DISPLAY_MEASURE_TIMEOUT_MS = 3000;

export type DisplaySize = { w: number; h: number; orientation: DisplayOrientation; dpi?: number };

export type DisplayFlowState =
  | { phase: 'measuring'; measuringSince?: number }
  | { phase: 'requesting'; size: DisplaySize; requestedAt: number }
  | { phase: 'starting'; sessionId: string }
  | { phase: 'streaming'; sessionId: string; inputEnabled: boolean }
  | { phase: 'failed'; reason: string }
  | { phase: 'exited'; reason: string };

export type DisplayFlowEvent =
  | { type: 'surfaceSize'; size: DisplaySize; linkConnected: boolean; now: number }
  // `stale`: the reply names a sessionId this app already saw before this frame
  // (a previous visit's session), so it cannot be the answer to the pending start.
  | { type: 'sessionReply'; payload: DisplaySessionPayload; stale: boolean }
  | { type: 'nativeState'; state: 'connecting' | 'streaming' | 'paused' | 'ended' | 'error'; reason?: string; inputEnabled?: boolean }
  | { type: 'tick'; now: number }
  | { type: 'userExit' }
  | { type: 'jsonLinkChanged'; connected: boolean };

export type DisplayEffect =
  | { kind: 'sendStart'; size: DisplaySize }
  | { kind: 'sendStop'; sessionId: string | null; reason?: DisplayReason }
  | { kind: 'nativeStart'; sessionId: string; videoPort: number }
  | { kind: 'nativeStop' }
  | { kind: 'goHome' };

export const INITIAL_DISPLAY_FLOW: DisplayFlowState = { phase: 'measuring' };

type Result = { state: DisplayFlowState; effects: DisplayEffect[] };

const isDisplayReason = (r: string | undefined): r is DisplayReason =>
  r !== undefined && (DISPLAY_REASONS as readonly string[]).includes(r);

function sendStop(sessionId: string | null, reason?: string): DisplayEffect {
  return isDisplayReason(reason) ? { kind: 'sendStop', sessionId, reason } : { kind: 'sendStop', sessionId };
}

export function reduceDisplayFlow(state: DisplayFlowState, event: DisplayFlowEvent): Result {
  const same: Result = { state, effects: [] };
  switch (event.type) {
    case 'surfaceSize': {
      if (state.phase !== 'measuring') return same;
      if (!event.linkConnected) return { state: { phase: 'failed', reason: 'mac-not-connected' }, effects: [] };
      return {
        state: { phase: 'requesting', size: event.size, requestedAt: event.now },
        effects: [{ kind: 'sendStart', size: event.size }],
      };
    }

    case 'sessionReply': {
      const p = event.payload;
      if (state.phase === 'requesting') {
        // Adopt the first reply whatever its sessionId, except: `superseded`
        // refers to the previous session the Mac just replaced, and a stale
        // reply (a sessionId already seen, e.g. the failed session a retry
        // replaces, ending late) belongs to an earlier visit. Both are ignored.
        if (p.state === 'ended' && p.reason === 'superseded') return same;
        if (event.stale && p.sessionId !== null) return same;
        if (p.state === 'ready') {
          if (p.sessionId === null) return same;
          return {
            state: { phase: 'starting', sessionId: p.sessionId },
            effects: [{ kind: 'nativeStart', sessionId: p.sessionId, videoPort: p.videoPort ?? DISPLAY_VIDEO_PORT }],
          };
        }
        return { state: { phase: 'failed', reason: p.reason ?? 'unknown' }, effects: [] };
      }
      if (state.phase === 'starting' || state.phase === 'streaming') {
        if (p.sessionId !== state.sessionId) return same;
        if (p.state === 'ready') return same;
        if (p.state === 'ended') {
          return { state: { phase: 'exited', reason: p.reason ?? 'ended' }, effects: [{ kind: 'nativeStop' }, { kind: 'goHome' }] };
        }
        return { state: { phase: 'failed', reason: p.reason ?? 'unknown' }, effects: [{ kind: 'nativeStop' }] };
      }
      return same;
    }

    case 'nativeState': {
      if (state.phase !== 'starting' && state.phase !== 'streaming') return same;
      switch (event.state) {
        case 'streaming':
          return { state: { phase: 'streaming', sessionId: state.sessionId, inputEnabled: event.inputEnabled ?? false }, effects: [] };
        case 'ended':
          return { state: { phase: 'exited', reason: event.reason ?? 'ended' }, effects: [{ kind: 'goHome' }] };
        case 'error':
          return {
            state: { phase: 'failed', reason: event.reason ?? 'unknown' },
            effects: [sendStop(state.sessionId, event.reason)],
          };
        default:
          return same; // connecting / paused keep the current phase
      }
    }

    case 'tick': {
      if (state.phase === 'measuring') {
        if (state.measuringSince === undefined) return { state: { phase: 'measuring', measuringSince: event.now }, effects: [] };
        if (event.now - state.measuringSince > DISPLAY_MEASURE_TIMEOUT_MS) {
          // Nothing was requested from the Mac, so there is nothing to stop.
          return { state: { phase: 'failed', reason: 'surface-unavailable' }, effects: [] };
        }
        return same;
      }
      if (state.phase !== 'requesting') return same;
      if (event.now - state.requestedAt <= DISPLAY_REPLY_TIMEOUT_MS) return same;
      return {
        state: { phase: 'failed', reason: 'reply-timeout' },
        effects: [sendStop(null, 'reply-timeout')],
      };
    }

    case 'userExit': {
      switch (state.phase) {
        case 'requesting':
          return { state: { phase: 'exited', reason: 'user-exit' }, effects: [sendStop(null, 'user-exit'), { kind: 'goHome' }] };
        case 'starting':
        case 'streaming':
          return {
            state: { phase: 'exited', reason: 'user-exit' },
            effects: [{ kind: 'nativeStop' }, sendStop(state.sessionId, 'user-exit'), { kind: 'goHome' }],
          };
        case 'measuring':
        case 'failed':
          return { state: { phase: 'exited', reason: 'user-exit' }, effects: [{ kind: 'goHome' }] };
        default:
          return same;
      }
    }

    case 'jsonLinkChanged':
      return same;
  }
}

// App-lifetime record of the display sessionIds the phone has seen: id -> the
// seq of the first display.session frame that carried it (0 when it was first
// seen some other way, e.g. a native start). Mutated in place; App.tsx owns it.
export type SeenDisplaySessions = Map<string, number>;

/** Record `sessionId` as seen by frame `seq`; the first sighting wins. */
export function noteDisplaySessionSeen(seen: SeenDisplaySessions, sessionId: string | null, seq: number): void {
  if (sessionId !== null && !seen.has(sessionId)) seen.set(sessionId, seq);
}

/**
 * Whether a reply naming `sessionId` is stale for a screen that sent its
 * display.start when App's frame counter stood at `startSeq`: the id was first
 * seen at or before that frame, so it belongs to an earlier start. Ids first
 * seen after the start was sent are never stale, however many later frames
 * (e.g. a duplicate ready batched with the first) repeat them. No start sent
 * yet (`startSeq` null) means nothing is pending, so nothing is stale.
 */
export function isStaleDisplayReply(seen: ReadonlyMap<string, number>, sessionId: string | null, startSeq: number | null): boolean {
  if (sessionId === null || startSeq === null) return false;
  const first = seen.get(sessionId);
  return first !== undefined && first <= startSeq;
}

const REASON_COPY: Record<string, string> = {
  unsupported: 'Not supported on this Mac',
  'permission-screen-recording': 'Allow Screen Recording for Desk Agent on your Mac',
  'no-device': 'Phone not detected over USB on the Mac',
  'mac-not-connected': 'Mac not connected',
  'token-timeout': "Couldn't get the session key from the Mac",
  'reply-timeout': "The Mac didn't answer — update Desk Agent on the Mac?",
  'version-mismatch': 'Update Desk Agent on the Mac and phone',
  'protocol-error': 'Update Desk Agent on the Mac and phone',
  'surface-unavailable': "The phone screen couldn't be prepared — try again",
  'capture-unavailable': "The Mac can't capture the display — check Screen Recording for Desk Agent",
  'connect-failed': "Couldn't connect to the Mac's display — try again",
};

export function displayReasonCopy(reason: string): string {
  return Object.prototype.hasOwnProperty.call(REASON_COPY, reason) ? REASON_COPY[reason]! : 'Display ended';
}
