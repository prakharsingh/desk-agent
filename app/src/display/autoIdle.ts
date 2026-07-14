import type { ScreensaverConfig } from '@desk-agent/protocol';

export function shouldAutoIdle(msSinceActivity: number, graceMs: number): boolean {
  return msSinceActivity >= graceMs;
}

export function shouldAutoIdleWithConfig(msSinceActivity: number, config: ScreensaverConfig): boolean {
  if (!config.enabled) return false;
  return shouldAutoIdle(msSinceActivity, config.graceMs);
}
