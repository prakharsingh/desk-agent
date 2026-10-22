import type { CameraConfig } from '@desk-agent/protocol';

// In-memory mirror of the phone's camera-presence setting -- the phone is the
// source of truth (persisted there via AsyncStorage), exactly like
// ScreensaverConfigStore. Holds only the last value the phone reported over
// event.publish('presence.cameraConfig'); null until the phone has connected
// and reported at least once, and null again once the last phone client
// disconnects -- otherwise an older phone app (one that never reports camera)
// connecting next would show the previous phone's value as if it were its own.
export class CameraConfigStore {
  private status: CameraConfig | null = null;

  constructor(private onChange: () => void) {}

  getStatus(): CameraConfig | null {
    return this.status;
  }

  setConfig(config: CameraConfig) {
    this.status = config;
    this.onChange();
  }

  /** Wired to WsGateway's connected-client count (see main.ts). */
  onClientCountChanged(count: number) {
    if (count > 0 || this.status === null) return;
    this.status = null;
    this.onChange();
  }
}
