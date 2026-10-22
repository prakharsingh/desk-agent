import type { LogLevel } from '@desk-agent/plugin-sdk';

export interface AdbRunner {
  /** Scoped to `serial` (`adb -s`) when known; null falls back to adb's default device. */
  reverse(localPort: number, remotePort: number, serial: string | null): Promise<void>;
  /** Hands a display session token to the phone app via `adb -s <serial> shell` stdin (never argv). Rejects on invalid values, non-zero exit, or `Error:` output. */
  deliverDisplayToken(serial: string, sessionId: string, token: string): Promise<void>;
  launchApp(serial: string | null): Promise<void>;
  /** Human-readable device model for the Device pane card title (e.g. "OnePlus 6T"), or null if the device reports none. Optional so lightweight fakes needn't implement it -- the model then just stays null. */
  getModel?(serial: string): Promise<string | null>;
  trackDevices(onEvent: (event: { type: 'attach' | 'detach' | 'unauthorized'; serial: string }) => void): { stop: () => void };
}

export type TunnelStatus = 'idle' | 'reissued' | 'failed';
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
  private tunnelStatus: TunnelStatus = 'idle';
  private lastReissueAt: number | null = null;
  private appLaunchStatus: AppLaunchStatus = 'idle';
  private lastAppLaunchAt: number | null = null;

  constructor(
    private adb: AdbRunner,
    private port: number,
    private onLog: (level: LogLevel, message: string) => void,
    private launchAppOnDock: boolean = true,
  ) {}

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
        void this.resolveModel(event.serial);
        void this.onAttach();
      } else {
        this.serial = null;
        this.model = null;
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

  /** Public so a user-initiated "Re-issue" action (Device pane) can call it directly, not just the internal on-attach trigger. */
  async reissue() {
    try {
      await this.adb.reverse(this.port, this.port, this.serial);
      this.tunnelStatus = 'reissued';
      this.lastReissueAt = Date.now();
      this.onLog('info', `adb reverse tcp:${this.port} tcp:${this.port} re-issued`);
    } catch (err) {
      this.tunnelStatus = 'failed';
      this.lastReissueAt = Date.now();
      this.onLog('error', `adb reverse failed: ${String(err)}`);
    }
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
