import type { LogLevel } from '@desk-agent/plugin-sdk';

export interface AdbRunner {
  reverse(localPort: number, remotePort: number): Promise<void>;
  trackDevices(onEvent: (event: { type: 'attach' | 'detach'; serial: string }) => void): { stop: () => void };
}

export type TunnelStatus = 'idle' | 'reissued' | 'failed';

export interface TunnelStatusSnapshot {
  serial: string | null;
  tunnelStatus: TunnelStatus;
  lastReissueAt: number | null;
}

export class TunnelSupervisor {
  private tracker?: { stop: () => void };
  private serial: string | null = null;
  private tunnelStatus: TunnelStatus = 'idle';
  private lastReissueAt: number | null = null;

  constructor(
    private adb: AdbRunner,
    private port: number,
    private onLog: (level: LogLevel, message: string) => void,
  ) {}

  start() {
    this.tracker = this.adb.trackDevices((event) => {
      if (event.type === 'attach') {
        this.serial = event.serial;
        void this.reissue();
      } else {
        this.serial = null;
      }
    });
  }

  stop() {
    this.tracker?.stop();
  }

  getStatus(): TunnelStatusSnapshot {
    return { serial: this.serial, tunnelStatus: this.tunnelStatus, lastReissueAt: this.lastReissueAt };
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
}
