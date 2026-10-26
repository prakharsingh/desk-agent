import type { LogLevel } from '@desk-agent/plugin-sdk';
import {
  DISPLAY_REASONS,
  DISPLAY_VIDEO_PORT,
  type DisplayReason,
  type DisplaySessionPayload,
  type DisplayStartPayload,
  type DisplayStopPayload,
} from '@desk-agent/protocol';
import type { ControlChannel } from './controlChannel.js';
import type { PortOutcome } from './tunnelSupervisor.js';

export interface DisplayCoordinatorDeps {
  /** null when there is no Electron transport (standalone core). */
  toApp: Pick<ControlChannel, 'notifyDisplayStartRequest' | 'notifyDisplayStopRequest'> | null;
  broadcast: (payload: DisplaySessionPayload) => void;
  getSerial: () => string | null;
  /** TunnelSupervisor's port surface. None of these reject. */
  tunnel: {
    addPort(port: number): Promise<boolean>;
    removePort(port: number): void;
    waitForPort(port: number, timeoutMs: number): Promise<PortOutcome>;
    waitForSerial(timeoutMs: number): Promise<string | null>;
  };
  deliverToken: (serial: string, sessionId: string, token: string) => Promise<void>;
  setSleepSuppressed: (suppressed: boolean) => void;
  recheckPresence: () => void;
  onLog: (level: LogLevel, message: string) => void;
}

/**
 * How long core waits for a phone to attach before giving up on a display session (`no-device`) or its token
 * (`token-delivery-failed`). After a core restart main's resync arrives before track-devices reports the phone, so a
 * null serial at that moment is a normal transient (Contract E).
 */
export const DISPLAY_DEVICE_WAIT_MS = 10_000;

/** End reasons the phone shows as a failure (`display.session{state:'error'}`); every other reason is a normal `ended`. */
export const DISPLAY_ERROR_REASONS: ReadonlySet<DisplayReason> = new Set<DisplayReason>([
  'unsupported', 'unsupported-host', 'no-device', 'permission-screen-recording', 'helper-crashed',
  'token-delivery-failed', 'port-in-use', 'capture-failed', 'capture-unavailable', 'protocol-error', 'version-mismatch',
  'display-offline', 'mac-asleep',
]);

function isDisplayReason(value: unknown): value is DisplayReason {
  return typeof value === 'string' && (DISPLAY_REASONS as readonly string[]).includes(value);
}

// Core's side of the extended-display session (Contract B). Electron main owns
// the helper process and the token; core owns adb (token delivery, the video
// port's reverse), sleep-on-absent suppression and the phone-facing
// display.session broadcast. The token is relayed to adb only -- never
// broadcast, never logged.
export class DisplayCoordinator {
  private activeSessionId: string | null = null;
  private activePort: number = DISPLAY_VIDEO_PORT;
  private readyPayload: DisplaySessionPayload | null = null;
  // The serial sent with the last start request: the token must go to that phone.
  private startSerial: string | null = null;
  // The session whose token is waiting for a phone to attach; an end for that session cancels the delivery.
  private waitingTokenSessionId: string | null = null;

  constructor(private deps: DisplayCoordinatorDeps) {}

  onPhoneStart(p: DisplayStartPayload): void {
    if (!this.deps.toApp) {
      this.deps.broadcast({ state: 'error', sessionId: null, reason: 'unsupported-host' });
      return;
    }
    const serial = this.deps.getSerial();
    if (serial === null) {
      this.deps.broadcast({ state: 'error', sessionId: null, reason: 'no-device' });
      return;
    }
    this.startSerial = serial;
    this.deps.onLog('info', `display start requested (${p.w}x${p.h} ${p.orientation})`);
    this.deps.toApp.notifyDisplayStartRequest({
      w: p.w, h: p.h, orientation: p.orientation, deviceSerial: serial,
      ...(p.dpi !== undefined ? { dpi: p.dpi } : {}),
    });
  }

  onPhoneStop(p: DisplayStopPayload): void {
    // Standalone: no session can exist, so there is nothing to stop.
    if (!this.deps.toApp) return;
    const reason: DisplayReason = isDisplayReason(p.reason) ? p.reason : 'user-exit';
    this.deps.toApp.notifyDisplayStopRequest({ sessionId: p.sessionId, reason });
  }

  /** Never rejects: a delivery failure asks main to stop the session. */
  async onDisplayToken(msg: { sessionId: string; token: string }): Promise<void> {
    // After a core restart main re-sends a pending session's token before track-devices has reported the phone.
    let serial = this.deps.getSerial();
    if (serial === null) {
      this.waitingTokenSessionId = msg.sessionId;
      serial = await this.deps.tunnel.waitForSerial(DISPLAY_DEVICE_WAIT_MS);
      const cancelled = this.waitingTokenSessionId !== msg.sessionId;
      if (!cancelled) this.waitingTokenSessionId = null;
      if (cancelled) {
        // Ended (or replaced by a newer token) while waiting: its helper is gone, so never am-start the phone for it.
        this.deps.onLog('info', `dropping the display token for session ${msg.sessionId}: the session ended while waiting for the phone`);
        return;
      }
    }
    if (serial === null) {
      this.deps.onLog('error', `display token delivery failed for session ${msg.sessionId}: no device attached within ${DISPLAY_DEVICE_WAIT_MS} ms`);
      this.deps.toApp?.notifyDisplayStopRequest({ sessionId: msg.sessionId, reason: 'token-delivery-failed' });
      return;
    }
    if (this.startSerial !== null && serial !== this.startSerial) {
      this.deps.onLog('error', `display token delivery failed for session ${msg.sessionId}: the phone changed since the start request`);
      this.deps.toApp?.notifyDisplayStopRequest({ sessionId: msg.sessionId, reason: 'token-delivery-failed' });
      return;
    }
    try {
      await this.deps.deliverToken(serial, msg.sessionId, msg.token);
      this.deps.onLog('info', `display token delivered for session ${msg.sessionId}`);
    } catch (err) {
      // AdbRunner already redacts the token; scrub again so no error shape can leak it.
      const detail = msg.token ? String(err).split(msg.token).join('<redacted>') : String(err);
      this.deps.onLog('error', `display token delivery failed for session ${msg.sessionId}: ${detail}`);
      this.deps.toApp?.notifyDisplayStopRequest({ sessionId: msg.sessionId, reason: 'token-delivery-failed' });
    }
  }

  /** Never rejects (TunnelSupervisor.addPort never rejects). */
  async onDisplaySession(msg: { active: boolean; sessionId: string | null; videoPort: number | null; reason?: DisplayReason }): Promise<void> {
    if (msg.active) {
      if (msg.sessionId === null) {
        this.deps.onLog('warn', 'ignoring an active display session without a sessionId');
        return;
      }
      const sessionId = msg.sessionId;
      const port = msg.videoPort ?? DISPLAY_VIDEO_PORT;
      // Never serve the previous session's ready payload for a new session.
      if (this.activeSessionId !== sessionId) this.readyPayload = null;
      this.activeSessionId = sessionId;
      this.activePort = port;
      this.deps.setSleepSuppressed(true);
      await this.deps.tunnel.addPort(port);
      // Ready means the reverse has landed. With no phone attached yet (core restart: main's resync precedes
      // track-devices) this waits for the attach; only no attach within DISPLAY_DEVICE_WAIT_MS gives up.
      const outcome = await this.deps.tunnel.waitForPort(port, DISPLAY_DEVICE_WAIT_MS);
      // The session may have ended (or been replaced) while waiting.
      if (this.activeSessionId !== sessionId || outcome === 'removed') return;
      if (outcome !== 'up') {
        // The session stays tracked: main's resulting end message clears suppression and the port as usual.
        const reason: DisplayReason = outcome === 'no-device' ? 'no-device' : 'port-in-use';
        this.deps.onLog('error', `display session ${sessionId}: video port ${port} reverse is not up (${reason}); asking main to stop`);
        this.deps.toApp?.notifyDisplayStopRequest({ sessionId, reason });
        return;
      }
      this.readyPayload = { state: 'ready', sessionId, videoPort: port };
      this.deps.broadcast(this.readyPayload);
      this.deps.onLog('info', `display session ${sessionId} ready on port ${port}`);
      return;
    }

    if (msg.sessionId !== null && msg.sessionId === this.waitingTokenSessionId) this.waitingTokenSessionId = null;
    // A stale end (another session, or a null sessionId) never clears the
    // active session's local state; the phone keys on sessionId, so its
    // ended/error is still broadcast.
    const stale = this.activeSessionId !== null && msg.sessionId !== this.activeSessionId;
    if (stale) {
      this.deps.onLog('info', `display session ${msg.sessionId ?? '(none)'} ended while ${this.activeSessionId} is active; keeping the active session`);
      this.broadcastEnd(msg.sessionId, msg.reason);
      return;
    }
    const wasActive = this.activeSessionId !== null;
    const port = this.activePort;
    this.activeSessionId = null;
    this.readyPayload = null;
    this.activePort = DISPLAY_VIDEO_PORT;
    this.deps.setSleepSuppressed(false);
    this.deps.tunnel.removePort(port);
    if (wasActive) this.deps.recheckPresence();
    this.broadcastEnd(msg.sessionId, msg.reason);
  }

  private broadcastEnd(sessionId: string | null, reason: DisplayReason | undefined) {
    if (reason === undefined) return; // silent clear (Contract B)
    const state = DISPLAY_ERROR_REASONS.has(reason) ? 'error' : 'ended';
    this.deps.onLog(state === 'error' ? 'warn' : 'info', `display session ${sessionId ?? '(none)'} ${state}: ${reason}`);
    this.deps.broadcast({ state, sessionId, reason });
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /** `{ state:'ready', sessionId, videoPort }` while a session is active (and its tunnel is open), else null. */
  getCurrentPayload(): DisplaySessionPayload | null {
    return this.readyPayload;
  }
}
