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
  // `midSession`: the failure ended a session the Mac had already made ready (starting/streaming),
  // as opposed to a start that never got a display.
  | { phase: 'failed'; reason: string; midSession?: true }
  | { phase: 'exited'; reason: string };

export type DisplayFlowEvent =
  | { type: 'surfaceSize'; size: DisplaySize; linkConnected: boolean; now: number }
  // `stale`: the reply names a sessionId this app already saw before this frame
  // (a previous visit's session), so it cannot be the answer to the pending start.
  | { type: 'sessionReply'; payload: DisplaySessionPayload; stale: boolean }
  | { type: 'nativeState'; state: 'connecting' | 'streaming' | 'paused' | 'ended' | 'error'; reason?: string; inputEnabled?: boolean }
  | { type: 'tick'; now: number }
  | { type: 'userExit' }
  // "Try again" on a retryable failure card (see canRetryDisplay).
  | { type: 'retry' }
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
        return { state: { phase: 'failed', reason: p.reason ?? 'unknown', midSession: true }, effects: [{ kind: 'nativeStop' }] };
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
            state: { phase: 'failed', reason: event.reason ?? 'unknown', midSession: true },
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

    case 'retry':
      // Back to measuring: the card unmounted the surface, so the remounted one reports its size
      // (it may have rotated) and that sends a new display.start. The failed session was already
      // stopped when the flow failed, and its late replies are stale for the new start.
      if (state.phase !== 'failed' || !canRetryDisplay(state.reason)) return same;
      return { state: { phase: 'measuring' }, effects: [] };

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

// Failures a plain new start can fix. display-offline: macOS took the display off the desktop
// (a Control Center "Window or App" choice it remembers for that display identity, with no way
// back in its UI); the Mac uses up that identity, so a new start comes up as a fresh display.
const RETRYABLE_REASONS: ReadonlySet<string> = new Set(['display-offline']);

export function canRetryDisplay(reason: string): boolean {
  return RETRYABLE_REASONS.has(reason);
}

// Failed Try agains in a row (display-offline right after each) before the card stops promising a
// fresh display: by then something other than one remembered identity keeps it off.
export const DISPLAY_OFFLINE_RETRY_LIMIT = 2;

const DISPLAY_OFFLINE_STUCK_COPY = 'macOS keeps switching Desk Agent Phone off. Quit and reopen Desk Agent on the Mac, then tap Try again.';

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
  // macOS kept the display out of the desktop at start (a persisted Control Center choice for that
  // display identity). The display is gone by the time this shows, so there is nothing to change in
  // Control Center or Screen Mirroring: the Mac uses a fresh identity on the next start.
  'display-offline': 'macOS has Desk Agent Phone switched off on the Mac — tap Try again and Desk Agent will use a fresh display',
  'mac-asleep': "The Mac's screen is asleep — wake and unlock it, then try again",
};

// Mid-session wording where it differs: the display was live, then macOS took it away.
const MID_SESSION_COPY: Record<string, string> = {
  'display-offline': "macOS took Desk Agent Phone off the Mac's desktop — tap Try again and Desk Agent will use a fresh display",
};

/** `failedRetries`: Try agains in a row this visit that ended in this failure again (see DISPLAY_OFFLINE_RETRY_LIMIT). */
export function displayReasonCopy(reason: string, midSession = false, failedRetries = 0): string {
  if (reason === 'display-offline' && failedRetries > DISPLAY_OFFLINE_RETRY_LIMIT) return DISPLAY_OFFLINE_STUCK_COPY;
  if (midSession && Object.prototype.hasOwnProperty.call(MID_SESSION_COPY, reason)) return MID_SESSION_COPY[reason]!;
  return Object.prototype.hasOwnProperty.call(REASON_COPY, reason) ? REASON_COPY[reason]! : 'Display ended';
}
