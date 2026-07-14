import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseScreensaverConfig, type ScreensaverConfig } from '@desk-agent/protocol';

const STORAGE_KEY = 'screensaverConfig';

// Matches today's pre-existing hardcoded behavior (AppShell.tsx's old
// GRACE_MS = 120000), so a phone that has never touched the settings
// screen and a Mac that has never sent a change both see the same
// behavior as before this feature existed.
export const DEFAULT_SCREENSAVER_CONFIG: ScreensaverConfig = { enabled: true, graceMs: 120000 };

export async function loadScreensaverConfig(): Promise<ScreensaverConfig> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SCREENSAVER_CONFIG;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return DEFAULT_SCREENSAVER_CONFIG;
  }
  const result = parseScreensaverConfig(parsedJson);
  return result.ok ? result.value : DEFAULT_SCREENSAVER_CONFIG;
}

export async function saveScreensaverConfig(config: ScreensaverConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
