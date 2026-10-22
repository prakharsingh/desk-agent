import crypto from 'node:crypto';
import fs from 'node:fs';
import type { ToCore } from '@desk-agent/core';
import { DISPLAY_VIDEO_PORT, type DisplayOrientation, type DisplayReason } from '@desk-agent/protocol';
import { stableDisplaySerial, type HelperEvent, type HelperStartCommand } from './displayHelperProtocol.js';

/** The slice of DisplayHelperHost the manager drives (one host per session). */
export interface HostLike {
  start(cmd: HelperStartCommand): void;
  stop(): void;
  isRunning(): boolean;
}

export interface DisplaySessionManagerOptions {
  createHost: (handlers: {
    onEvent: (e: HelperEvent) => void;
    onExit: (info: { reason: DisplayReason; error?: string }) => void;
    /** The helper process actually spawned; the token is held until then. */
    onSpawn: () => void;
  }) => HostLike;
  sendToCore: (msg: ToCore) => void;
  getIds: () => { vendorId: number; productId: number };
  /** Darwin 23 = macOS 14 Sonoma. */
  isSupportedMacOS: () => boolean;
  /** Tray refresh. */
  onChange?: () => void;
  onLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  randomToken?: () => string;
  randomSessionId?: () => string;
  /** Dev only (!app.isPackaged && DESK_AGENT_DISPLAY_DEV_TOKEN_FILE): the current token is written here, mode 0600. */
  devTokenFile?: string | null;
}

export interface DisplayStartRequest {
  w: number;
  h: number;
  orientation: DisplayOrientation;
  deviceSerial: string;
  dpi?: number;
}

/**
 * Helper-reported end reasons that beat main's own stop reason: core's DISPLAY_ERROR_REASONS (a parity test pins it)
 * minus `helper-crashed`, which the host synthesizes for any exit without an `ended` line (e.g. main's SIGKILL
 * escalation) and so must not mask why main stopped. A local copy: importing @desk-agent/core at runtime would pull
 * core's whole module graph into Electron main.
 */
export const HELPER_ERROR_REASONS: ReadonlySet<DisplayReason> = new Set<DisplayReason>([
  'unsupported', 'unsupported-host', 'no-device', 'permission-screen-recording',
  'token-delivery-failed', 'port-in-use', 'capture-failed', 'capture-unavailable', 'protocol-error', 'version-mismatch',
]);

// Core's adb delivery (displayCoordinator) rejects any other token shape.
const TOKEN_RE = /^[A-Za-z0-9-]{1,128}$/;

interface Session {
  sessionId: string;
  host: HostLike | null;
  /** The helper reported `ready` and core was told the session is active. */
  ready: boolean;
  /** Why main stopped the helper; wins over the helper's generic `stop-requested`. */
  stopReason: DisplayReason | null;
  ended: boolean;
  tokenSent: boolean;
  /** Kept so a core restart can re-arm the phone for a session that is still pending. */
  token: string;
}

/**
 * Owns the display-session lifecycle in Electron main: one pending/active helper session at a time. A new start
 * supersedes the current one and waits for the old helper to exit. A session ends toward core exactly once, from
 * the host's onExit, always with its own sessionId.
 */
export class DisplaySessionManager {
  private current: Session | null = null;
  private queued: DisplayStartRequest | null = null;
  private resyncArmed = false;
  private shuttingDown = false;

  constructor(private readonly opts: DisplaySessionManagerOptions) {}

  handleStartRequest(req: DisplayStartRequest): void {
    if (this.shuttingDown) return;
    if (!this.opts.isSupportedMacOS()) {
      this.opts.onLog('warn', 'phone display needs macOS 14 or later');
      // No session was started, so there is no sessionId to end.
      this.opts.sendToCore({ kind: 'displaySession', active: false, sessionId: null, videoPort: null, reason: 'unsupported' });
      return;
    }
    if (this.current) {
      // One session at a time: the newest start wins, and it waits for the old helper to exit.
      this.queued = req;
      this.opts.onLog('info', `display session ${this.current.sessionId} superseded by a new start`);
      this.stopCurrent('superseded');
      return;
    }
    this.startNow(req);
  }

  handleStopRequest(req: { sessionId: string | null; reason: DisplayReason }): void {
    const cur = this.current;
    if (!cur) return;
    if (req.sessionId !== null && req.sessionId !== cur.sessionId) {
      this.opts.onLog('info', `ignoring a display stop for stale session ${req.sessionId}`);
      return;
    }
    // A null sessionId comes from a phone that never learned its session: it cancels a queued start too.
    if (req.sessionId === null) this.queued = null;
    this.stopCurrent(req.reason);
  }

  disconnectFromMenu(): void {
    this.queued = null;
    this.stopCurrent('mac-disconnect');
  }

  onCoreRunning(): void {
    this.resyncArmed = true;
  }

  onCoreSnapshot(): void {
    if (!this.resyncArmed) return;
    this.resyncArmed = false;
    const cur = this.current;
    // A session main is already stopping ends shortly; its end message clears core either way.
    if (!cur || cur.ended || cur.stopReason !== null) return;
    if (cur.ready) this.sendActive(cur);
    // Pending (token out, helper not ready yet): the old core's delivery may have died with it, so hand the new
    // core the token again -- it re-`am start`s the phone with the session extras once the phone attaches.
    else if (cur.tokenSent) this.opts.sendToCore({ kind: 'displayToken', sessionId: cur.sessionId, token: cur.token });
  }

  isActive(): boolean {
    return this.current?.ready === true;
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.queued = null;
    this.stopCurrent('mac-disconnect');
  }

  private stopCurrent(reason: DisplayReason): void {
    const cur = this.current;
    // Already stopping: the first reason main stopped with is the one core hears.
    if (!cur || cur.stopReason !== null) return;
    cur.stopReason = reason;
    cur.host?.stop();
  }

  private startNow(req: DisplayStartRequest): void {
    const token = (this.opts.randomToken ?? (() => crypto.randomBytes(32).toString('hex')))();
    const sessionId = (this.opts.randomSessionId ?? (() => crypto.randomUUID()))();
    if (!TOKEN_RE.test(token)) {
      // Unreachable with the default generator; never spawn a helper core cannot authenticate.
      this.opts.onLog('error', 'display token has an invalid shape; refusing to start');
      this.opts.sendToCore({ kind: 'displaySession', active: false, sessionId, videoPort: null, reason: 'token-delivery-failed' });
      return;
    }
    let ids: { vendorId: number; productId: number };
    try {
      ids = this.opts.getIds();
    } catch (err) {
      this.opts.onLog('error', `display ids unavailable: ${err instanceof Error ? err.message : String(err)}`);
      this.opts.sendToCore({ kind: 'displaySession', active: false, sessionId, videoPort: null, reason: 'helper-crashed' });
      return;
    }

    const session: Session = { sessionId, host: null, ready: false, stopReason: null, ended: false, tokenSent: false, token };
    this.current = session;
    const host = this.opts.createHost({
      onEvent: (e) => this.onEvent(session, e),
      onExit: (info) => this.onExit(session, info),
      onSpawn: () => this.onSpawn(session, token),
    });
    session.host = host;
    this.opts.onLog('info', `starting display session ${sessionId} (${req.w}x${req.h} ${req.orientation})`);
    try {
      host.start({
        cmd: 'start', sessionId, token, port: DISPLAY_VIDEO_PORT,
        surfaceW: req.w, surfaceH: req.h, orientation: req.orientation,
        serialNum: stableDisplaySerial(req.deviceSerial),
        vendorId: ids.vendorId, productId: ids.productId,
        ...(req.dpi !== undefined ? { dpi: req.dpi } : {}),
      });
    } catch (err) {
      this.onExit(session, { reason: 'helper-crashed', error: err instanceof Error ? err.message : String(err) });
      return;
    }
    // The token waits for onSpawn: core `am start`s the phone with it, which is pointless (and misleading) for a
    // helper that never ran (ENOENT/EACCES on a mis-packaged path).
    if (!session.ended) this.changed();
  }

  private onSpawn(session: Session, token: string): void {
    // A dead, replaced or already-stopping session gets no token.
    if (session.ended || session !== this.current || session.stopReason !== null || session.tokenSent) return;
    session.tokenSent = true;
    this.writeDevToken(token);
    this.opts.sendToCore({ kind: 'displayToken', sessionId: session.sessionId, token });
    this.changed();
  }

  private onEvent(session: Session, e: HelperEvent): void {
    if (session.ended || session !== this.current) return;
    switch (e.evt) {
      case 'ready':
        // A helper main is already stopping (e.g. superseded before ready) must never become active.
        if (session.stopReason !== null) {
          this.opts.onLog('info', `ignoring ready from display session ${session.sessionId}: stopping (${session.stopReason})`);
          break;
        }
        session.ready = true;
        this.sendActive(session);
        this.changed();
        break;
      case 'log':
        this.opts.onLog(e.level, e.message);
        break;
      case 'stats':
        this.opts.onLog('info',
          `display stats: fps ${e.fps}, ${e.kbps} kbps, unacked ${e.unacked}, ack p50/p95 ${e.ackP50Ms}/${e.ackP95Ms} ms, ` +
          `phone rendered ${e.phoneRendered} dropped ${e.phoneDropped}`);
        break;
      case 'ended':
        // Informational only: onExit (which carries the same reason) ends the session.
        this.opts.onLog('info', `display helper ended: ${e.reason}`);
        break;
      default:
        this.opts.onLog('info', `display ${session.sessionId}: ${e.evt}`);
    }
  }

  private onExit(session: Session, info: { reason: DisplayReason; error?: string }): void {
    if (session.ended) return;
    session.ended = true;
    if (info.error !== undefined) this.opts.onLog('error', `display helper failed to start: ${info.error}`);
    // A real helper error (e.g. permission-screen-recording) explains the end better than why main stopped it.
    const reason = HELPER_ERROR_REASONS.has(info.reason) ? info.reason : (session.stopReason ?? info.reason);
    this.opts.onLog(reason === 'helper-crashed' ? 'error' : 'info', `display session ${session.sessionId} ended: ${reason}`);
    const next = this.queued;
    this.queued = null;
    const startsNext = next !== null && !this.shuttingDown;
    // A queued start is about to replace this session. The phone waiting for it cannot tell this session's end
    // from its own reply (it may never have seen this sessionId), so core hears `superseded` -- which the phone
    // ignores while requesting -- even when the real reason is a helper error, which is stale for that phone.
    // The real reason is logged above.
    const reported: DisplayReason = startsNext ? 'superseded' : reason;
    if (startsNext && reason !== 'superseded') {
      this.opts.onLog('info', `display session ${session.sessionId}: reporting ${reason} to core as superseded (a queued start follows)`);
    }
    this.opts.sendToCore({ kind: 'displaySession', active: false, sessionId: session.sessionId, videoPort: null, reason: reported });
    this.clearDevToken();
    if (this.current === session) this.current = null;
    this.changed();
    if (startsNext) this.startNow(next);
  }

  /** Never after shutdown: the tray may already be destroyed. */
  private changed(): void {
    if (!this.shuttingDown) this.opts.onChange?.();
  }

  private sendActive(session: Session): void {
    this.opts.sendToCore({ kind: 'displaySession', active: true, sessionId: session.sessionId, videoPort: DISPLAY_VIDEO_PORT });
  }

  private writeDevToken(token: string): void {
    const file = this.opts.devTokenFile;
    if (!file) return;
    try {
      // `mode` only applies on create, so never write into an existing (possibly looser) file.
      fs.rmSync(file, { force: true });
      fs.writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      this.opts.onLog('warn', `could not write the dev token file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private clearDevToken(): void {
    const file = this.opts.devTokenFile;
    if (!file) return;
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // best effort
    }
  }
}
