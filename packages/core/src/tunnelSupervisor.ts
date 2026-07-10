export interface AdbRunner {
  reverse(localPort: number, remotePort: number): Promise<void>;
  trackDevices(onEvent: (event: { type: 'attach' | 'detach'; serial: string }) => void): { stop: () => void };
}

export class TunnelSupervisor {
  private tracker?: { stop: () => void };

  constructor(
    private adb: AdbRunner,
    private port: number,
    private onLog: (level: string, message: string) => void,
  ) {}

  start() {
    this.tracker = this.adb.trackDevices((event) => {
      if (event.type === 'attach') void this.reissue();
    });
  }

  stop() {
    this.tracker?.stop();
  }

  private async reissue() {
    try {
      await this.adb.reverse(this.port, this.port);
      this.onLog('info', `adb reverse tcp:${this.port} tcp:${this.port} re-issued`);
    } catch (err) {
      this.onLog('error', `adb reverse failed: ${String(err)}`);
    }
  }
}
