import type { LogLevel } from '@desk-agent/plugin-sdk';

export interface AdbRunner {
  reverse(localPort: number, remotePort: number): Promise<void>;
  launchApp(serial: string | null): Promise<void>;
  trackDevices(onEvent: (event: { type: 'attach' | 'detach'; serial: string }) => void): { stop: () => void };
}

export type TunnelStatus = 'idle' | 'reissued' | 'failed';
export type AppLaunchStatus = 'idle' | 'launched' | 'failed';

export interface TunnelStatusSnapshot {
  serial: string | null;
  tunnelStatus: TunnelStatus;
  lastReissueAt: number | null;
  launchAppOnDock: boolean;
  appLaunchStatus: AppLaunchStatus;
  lastAppLaunchAt: number | null;
}

export class TunnelSupervisor {
  private tracker?: { stop: () => void };
  private serial: string | null = null;
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
      if (event.type === 'attach') {
        this.serial = event.serial;
        void this.onAttach();
      } else {
        this.serial = null;
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

  stop() {
    this.tracker?.stop();
  }

  getStatus(): TunnelStatusSnapshot {
    return {
      serial: this.serial,
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
      await this.adb.reverse(this.port, this.port);
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
