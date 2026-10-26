// Startup probe for the privacy grants the extended display depends on. Logged
// once per launch so the TCC persistence test (packaging/MAC_SIGNING.md) can
// read whether a grant survived an update. Pure: index.ts supplies the values
// from systemPreferences without ever prompting.

export type ScreenAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export function describePermissionStatus(
  screen: ScreenAccessStatus,
  accessibilityTrusted: boolean,
  appVersion: string,
): string {
  return `v${appVersion} screen-recording=${screen} accessibility=${accessibilityTrusted}`;
}
