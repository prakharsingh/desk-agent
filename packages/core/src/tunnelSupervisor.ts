import type { LogLevel } from '@desk-agent/plugin-sdk';

export interface AdbRunner {
  /** Scoped to `serial` (`adb -s`) when known; null falls back to adb's default device. */
  reverse(localPort: number, remotePort: number, serial: string | null): Promise<void>;
  /** `adb [-s serial] reverse --remove tcp:<port>`. The real runner never rejects (it logs failures); callers still guard. */
  removeReverse(port: number, serial: string | null): Promise<void>;
  /** Hands a display session token to the phone app via `adb -s <serial> shell` stdin (never argv). Rejects on invalid values, non-zero exit, or `Error:` output. */
  deliverDisplayToken(serial: string, sessionId: string, token: string): Promise<void>;
  launchApp(serial: string | null): Promise<void>;
  /** Human-readable device model for the Device pane card title (e.g. "OnePlus 6T"), or null if the device reports none. Optional so lightweight fakes needn't implement it -- the model then just stays null. */
  getModel?(serial: string): Promise<string | null>;
  trackDevices(onEvent: (event: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void): { stop: () => void };
}

export type TunnelStatus = 'idle' | 'reissued' | 'failed';
/** How a wait for a runtime port settled: its reverse landed, failed on an attached device, no device attached in time, or the port was removed. */
export type PortOutcome = 'up' | 'failed' | 'no-device' | 'removed';
export type AppLaunchStatus = 'idle' | 'launched' | 'failed';

export interface TunnelStatusSnapshot {
  serial: string | null;
  /** Device model name, resolved once per attach; null until known, and cleared on detach. */
  model: string | null;
  /** Serial of a connected device that has not authorized this Mac (RSA prompt pending); cleared on attach/detach of that serial. */
  unauthorizedSerial: string | null;
  tunnelStatus: TunnelStatus;
  lastReissueAt: number | null;
  launchAppOnDock: boolean;
  appLaunchStatus: AppLaunchStatus;
  lastAppLaunchAt: number | null;
}

export class TunnelSupervisor {
  private tracker?: { stop: () => void };
  private serial: string | null = null;
  private model: string | null = null;
  private unauthorizedSerial: string | null = null;
  /** Ports to reverse: the JSON port (never removable) plus any added at runtime (e.g. the display video port). */
  private ports = new Set<number>();
  private failedPorts = new Set<number>();
  /** Ports whose reverse has actually landed on the current device (cleared on detach) -- readiness, not registration. */
  private upPorts = new Set<number>();
  /** Per-port adb operation chain: reverse / remove for one port run strictly in order. */
  private portChains = new Map<number, Promise<void>>();
  private portWaiters = new Map<number, Set<(outcome: PortOutcome) => void>>();
  private serialWaiters = new Set<(serial: string) => void>();
  private tunnelStatus: TunnelStatus = 'idle';
  private lastReissueAt: number | null = null;
  private appLaunchStatus: AppLaunchStatus = 'idle';
  private lastAppLaunchAt: number | null = null;

  constructor(
    private adb: AdbRunner,
    private port: number,
    private onLog: (level: LogLevel, message: string) => void,
    private launchAppOnDock: boolean = true,
  ) {
    this.ports.add(port);
  }

  start() {
    this.tracker = this.adb.trackDevices((event) => {
      if (event.type === 'unauthorized') {
        this.unauthorizedSerial = event.serial;
        return;
      }
      if (this.unauthorizedSerial === event.serial) this.unauthorizedSerial = null;
      // A detach for a phone that is not the attached one (e.g. an
      // unauthorized-only serial leaving) must not disturb the attached phone.
      if (event.type === 'detach' && this.serial !== event.serial) return;
      if (event.type === 'attach') {
        this.serial = event.serial;
        this.model = null;
        // A failure belongs to the device it happened on; the attach pass re-establishes every port.
        this.failedPorts.clear();
        for (const notify of [...this.serialWaiters]) notify(event.serial);
        void this.resolveModel(event.serial);
        void this.onAttach();
      } else {
        this.serial = null;
        this.model = null;
        // The reverses (and their failures) died with the device.
        this.upPorts.clear();
        this.failedPorts.clear();
      }
    });
  }

  // reissue() never rejects (it catches its own errors), so awaiting it here
  // is safe -- this just guarantees the tunnel is actually up (not merely
  // requested) before the app boots and tries to open its WebSocket, rather
  // than racing two independent adb child processes.
  private async onAttach() {
    await this.reissue();
    if (this.launchAppOnDock) await this.launchApp();
  }

  // Runs alongside (not before) the tunnel/app-launch sequence: it's purely
  // cosmetic, so it must never delay the tunnel coming up. Never rejects.
  private async resolveModel(serial: string) {
    if (!this.adb.getModel) return;
    try {
      const model = await this.adb.getModel(serial);
      // The device may have detached (or another attached) while getprop ran.
      if (this.serial === serial) this.model = model;
    } catch (err) {
      this.onLog('warn', `adb getprop (device model) failed: ${String(err)}`);
    }
  }

  stop() {
    this.tracker?.stop();
  }

  getStatus(): TunnelStatusSnapshot {
    return {
      serial: this.serial,
      model: this.model,
      unauthorizedSerial: this.unauthorizedSerial,
      tunnelStatus: this.tunnelStatus,
      lastReissueAt: this.lastReissueAt,
      launchAppOnDock: this.launchAppOnDock,
      appLaunchStatus: this.appLaunchStatus,
      lastAppLaunchAt: this.lastAppLaunchAt,
    };
  }

  /** Live, session-scoped toggle for the Device pane switch -- mirrors AutomationEngine.setEnabled: not persisted to config.json, resets to the config-supplied constructor default on core restart. */
  setLaunchAppOnDock(enabled: boolean) {
    this.launchAppOnDock = enabled;
  }

  getSerial(): string | null {
    return this.serial;
  }

  getPorts(): number[] {
    return [...this.ports];
  }

  /** Registers a port to be reversed on every (re)issue; reverses it right away when a device is attached. Never rejects: resolves true only when the reverse has landed (false: no device yet, the reverse failed, or the port was removed meanwhile). */
  async addPort(port: number): Promise<boolean> {
    if (this.ports.has(port)) return this.upPorts.has(port);
    this.ports.add(port);
    if (this.serial === null) return false;
    await this.reversePort(port);
    this.updateStatus();
    return this.upPorts.has(port);
  }

  /**
   * Settles once `port` (registered via addPort) is usable: `up` when its reverse has landed, `failed` when the reverse
   * failed on an attached device, `removed` if the port is removed meanwhile, `no-device` when no device is attached
   * at a `timeoutMs` deadline (the deadline re-arms while a device is attached and its reverse is still in flight).
   */
  waitForPort(port: number, timeoutMs: number): Promise<PortOutcome> {
    if (!this.ports.has(port)) return Promise.resolve('removed');
    if (this.upPorts.has(port)) return Promise.resolve('up');
    if (this.serial !== null && this.failedPorts.has(port)) return Promise.resolve('failed');
    return new Promise<PortOutcome>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiters = this.portWaiters.get(port) ?? new Set();
      this.portWaiters.set(port, waiters);
      const done = (outcome: PortOutcome) => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve(outcome);
      };
      const arm = () => {
        timer = setTimeout(() => (this.serial === null ? done('no-device') : arm()), timeoutMs);
      };
      waiters.add(done);
      arm();
    });
  }

  /** The attached serial, waiting up to `timeoutMs` for an attach; null if none attached in time. */
  waitForSerial(timeoutMs: number): Promise<string | null> {
    if (this.serial !== null) return Promise.resolve(this.serial);
    return new Promise<string | null>((resolve) => {
      const done = (serial: string | null) => {
        clearTimeout(timer);
        this.serialWaiters.delete(done);
        resolve(serial);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      this.serialWaiters.add(done);
    });
  }

  /** Stops re-issuing `port` and tears down its reverse on the attached device. The JSON port cannot be removed. Never throws. */
  removePort(port: number): void {
    if (port === this.port || !this.ports.has(port)) return;
    this.ports.delete(port);
    this.failedPorts.delete(port);
    this.upPorts.delete(port);
    this.notifyPort(port, 'removed');
    // Queued behind any in-flight reverse of this port, so it runs after it lands -- and before any later re-add.
    if (this.serial !== null) void this.removeReverse(port, this.serial);
  }

  private notifyPort(port: number, outcome: PortOutcome) {
    const waiters = this.portWaiters.get(port);
    if (!waiters) return;
    for (const done of [...waiters]) done(outcome);
  }

  /** Runs `op` after every earlier op for `port`; an idle port starts it synchronously (adb is spawned in this tick). */
  private enqueue(port: number, op: () => Promise<void>): Promise<void> {
    const prev = this.portChains.get(port);
    const next = (prev ? prev.then(op) : op()).catch(() => {}).then(() => {
      if (this.portChains.get(port) === next) this.portChains.delete(port);
    });
    this.portChains.set(port, next);
    return next;
  }

  private removeReverse(port: number, serial: string): Promise<void> {
    return this.enqueue(port, async () => {
      try {
        await this.adb.removeReverse(port, serial);
      } catch (err) {
        this.onLog('warn', `adb reverse --remove tcp:${port} failed: ${String(err)}`);
      }
    });
  }

  private reversePort(port: number): Promise<void> {
    const serial = this.serial;
    return this.enqueue(port, async () => {
      // Removed, or the device changed, while queued: a removal / the next attach pass owns the port now.
      if (!this.ports.has(port) || this.serial !== serial) return;
      try {
        await this.adb.reverse(port, port, serial);
        this.onLog('info', `adb reverse tcp:${port} tcp:${port} re-issued`);
        // Removed (its queued remove runs next) or detached while in flight: not up.
        if (this.ports.has(port) && this.serial === serial) {
          this.failedPorts.delete(port);
          this.upPorts.add(port);
          this.notifyPort(port, 'up');
        }
      } catch (err) {
        this.onLog('error', `adb reverse failed: ${String(err)}`);
        // A stale device's late failure must not poison the port for its replacement.
        if (this.ports.has(port) && this.serial === serial) {
          this.failedPorts.add(port);
          this.upPorts.delete(port);
          if (serial !== null) this.notifyPort(port, 'failed');
        }
      }
      this.lastReissueAt = Date.now();
    });
  }

  private updateStatus() {
    const anyFailed = [...this.failedPorts].some((p) => this.ports.has(p));
    this.tunnelStatus = anyFailed ? 'failed' : 'reissued';
  }

  /** Public so a user-initiated "Re-issue" action (Device pane) can call it directly, not just the internal on-attach trigger. Reverses every registered port; never rejects. */
  async reissue() {
    // serial === null is intentional (pre-existing): adb then uses its default device, which the JSON port relies on.
    const serial = this.serial;
    for (const port of [...this.ports]) {
      // Stop if the device changed mid-pass: the next attach issues its own pass.
      if (this.serial !== serial) break;
      if (!this.ports.has(port)) continue;
      await this.reversePort(port);
    }
    this.updateStatus();
  }

  /** Public so a manual "Launch now" action (Device pane) can call it directly, regardless of the launchAppOnDock toggle -- same reasoning as reissue() above. Failure here is non-fatal to the tunnel itself. */
  async launchApp() {
    try {
      await this.adb.launchApp(this.serial);
      this.appLaunchStatus = 'launched';
      this.lastAppLaunchAt = Date.now();
      this.onLog('info', 'phone app launch requested');
    } catch (err) {
      this.appLaunchStatus = 'failed';
      this.lastAppLaunchAt = Date.now();
      this.onLog('error', `phone app launch failed: ${String(err)}`);
    }
  }
}
