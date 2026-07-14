import type { ScreensaverConfig } from '@desk-agent/protocol';

// In-memory mirror of the phone's screensaver config -- the phone is the
// real source of truth (persisted there via AsyncStorage); this holds only
// the last-known value reported to core over event.publish('screensaver.config'),
// null until the phone has connected and reported at least once. No
// config-schema default is needed: see the design doc's "no independent
// config-schema default" decision.
export class ScreensaverConfigStore {
  private status: ScreensaverConfig | null = null;

  constructor(private onChange: () => void) {}

  getStatus(): ScreensaverConfig | null {
    return this.status;
  }

  setConfig(config: ScreensaverConfig) {
    this.status = config;
    this.onChange();
  }
}
