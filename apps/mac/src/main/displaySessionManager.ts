import crypto from 'node:crypto';
import fs from 'node:fs';
import type { ToCore } from '@desk-agent/core';
import { DISPLAY_VIDEO_PORT, type DisplayOrientation, type DisplayReason } from '@desk-agent/protocol';
import { displayIdentitySerial, stableDisplaySerial, type HelperEvent, type HelperStartCommand } from './displayHelperProtocol.js';
import type { DisplayIdentityGenerations } from './displayIdentityStore.js';

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
  /**
   * Per-phone display-identity generation (Ruling P0-7). Absent: every session is generation 0 (the fresh
   * identity is still offered, it just is not remembered).
   */
  identityStore?: DisplayIdentityGenerations;
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
  'display-offline', 'mac-asleep',
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
  /** The phone's display identity: store key, the generation this session started from, its serials. */
  identity: { phoneKey: string; generation: number; serialNum: number; freshSerial: number };
  /** The identity serial the helper reported in `ready` (undefined before ready, or from an older helper). */
  liveSerial?: number;
  /** The helper's `ended` said this start created the fresh identity too. */
  freshTried?: boolean;
}

const hex32 = (n: number) => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

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

    const identity = this.identityFor(req.deviceSerial);
    const session: Session = { sessionId, host: null, ready: false, stopReason: null, ended: false, tokenSent: false, token, identity };
    this.current = session;
    const host = this.opts.createHost({
      onEvent: (e) => this.onEvent(session, e),
      onExit: (info) => this.onExit(session, info),
      onSpawn: () => this.onSpawn(session, token),
    });
    session.host = host;
    this.opts.onLog('info', `starting display session ${sessionId} (${req.w}x${req.h} ${req.orientation}) on display identity generation ` +
      `${identity.generation} (${hex32(identity.serialNum)}; fresh ${hex32(identity.freshSerial)} if every known identity is switched off)`);
    try {
      host.start({
        cmd: 'start', sessionId, token, port: DISPLAY_VIDEO_PORT,
        surfaceW: req.w, surfaceH: req.h, orientation: req.orientation,
        serialNum: identity.serialNum, freshSerial: identity.freshSerial,
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
        session.liveSerial = e.serialNum;
        this.sendActive(session);
        this.noteIdentity(session, e.serialNum);
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
        // Informational: onExit (which carries the same reason) ends the session. The host delivers it first.
        if (e.freshTried) session.freshTried = true;
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
    // Before a queued start reads the store, so that start already gets the fresh identity.
    if (info.reason === 'display-offline') this.useUpIdentity(session);
    this.opts.sendToCore({ kind: 'displaySession', active: false, sessionId: session.sessionId, videoPort: null, reason: reported });
    this.clearDevToken();
    if (this.current === session) this.current = null;
    this.changed();
    if (startsNext) this.startNow(next);
  }

  /** Generation 0 (today's serial, so the existing arrangement stays valid) unless this phone escalated before. */
  private identityFor(deviceSerial: string): Session['identity'] {
    const phoneKey = stableDisplaySerial(deviceSerial).toString(16).padStart(8, '0');
    let generation = 0;
    try {
      generation = this.opts.identityStore?.getGeneration(phoneKey) ?? 0;
    } catch (err) {
      this.opts.onLog('warn', `display identity generation unreadable, using 0: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {
      phoneKey, generation,
      serialNum: displayIdentitySerial(deviceSerial, generation),
      freshSerial: displayIdentitySerial(deviceSerial, generation + 1),
    };
  }

  /**
   * Logs which identity came up. The fresh identity coming online saves the next generation: it is online and
   * capturable, so it is the phone's new last-good identity (Ruling P0-7). The other moment a generation is saved
   * is a `display-offline` end (useUpIdentity): the generation after the used-up identity, forward-only, uncapped.
   */
  private noteIdentity(session: Session, serialNum: number | undefined): void {
    const { identity } = session;
    if (serialNum === undefined) return; // an older helper does not say
    if (serialNum !== identity.freshSerial) {
      this.opts.onLog('info', `display session ${session.sessionId} uses display identity ${hex32(serialNum)} (generation ${identity.generation})`);
      return;
    }
    const next = identity.generation + 1;
    try {
      this.opts.identityStore?.setGeneration(identity.phoneKey, next);
      this.opts.onLog('info', `display session ${session.sessionId} uses the fresh display identity ${hex32(serialNum)}: ` +
        `generation ${next} saved for this phone (macOS keeps every earlier identity switched off)`);
    } catch (err) {
      this.opts.onLog('warn', `display identity generation ${next} could not be saved (the next session escalates again): ` +
        `${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The session ended `display-offline`: macOS took the display off the desktop, at start (every identity tried
   * came up switched off) or mid-session (e.g. Control Center's "Window or App"). macOS remembers that per identity
   * and offers no way back, so the identity is used up for good: the next start moves to a generation macOS has no
   * saved state for. The used-up identity belongs to the fresh generation when the helper reported it in `ready`
   * or, for a start that never got ready, when its `ended` says the fresh identity was tried (it came up offline
   * too); otherwise to the session's own generation (its primary or spare). Idempotent: the store only ever moves
   * forward to the generation after the used-up one, never past it twice. No cap: every switch-off burns one.
   * Never for other end reasons (mac-asleep, capture-failed, ...), which say nothing about the identity.
   */
  private useUpIdentity(session: Session): void {
    const { identity } = session;
    const freshUsed = session.liveSerial === identity.freshSerial || (session.liveSerial === undefined && session.freshTried === true);
    const usedGeneration = freshUsed ? identity.generation + 1 : identity.generation;
    const used = session.liveSerial ?? (freshUsed ? identity.freshSerial : identity.serialNum);
    const next = usedGeneration + 1;
    try {
      const store = this.opts.identityStore;
      if (!store) return;
      if (store.getGeneration(identity.phoneKey) >= next) return;
      store.setGeneration(identity.phoneKey, next);
      this.opts.onLog('info', `display session ${session.sessionId} ended display-offline: display identity ${hex32(used)} ` +
        `(generation ${usedGeneration}) is used up, generation ${next} saved for this phone (macOS keeps it switched off)`);
    } catch (err) {
      this.opts.onLog('warn', `display identity generation ${next} could not be saved after display-offline (the next session ` +
        `escalates from generation ${identity.generation} again): ${err instanceof Error ? err.message : String(err)}`);
    }
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
