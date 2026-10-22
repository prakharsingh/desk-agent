import type { ScreensaverConfig } from '@desk-agent/protocol';
import type { Screen } from './screens.js';

export function shouldAutoIdle(msSinceActivity: number, graceMs: number): boolean {
  return msSinceActivity >= graceMs;
}

export function shouldAutoIdleWithConfig(msSinceActivity: number, config: ScreensaverConfig): boolean {
  if (!config.enabled) return false;
  return shouldAutoIdle(msSinceActivity, config.graceMs);
}

// The extended-display screen streams continuously; the phone must never idle out of it.
export function isAutoIdleExempt(screen: Screen): boolean {
  return screen === 'display';
}
