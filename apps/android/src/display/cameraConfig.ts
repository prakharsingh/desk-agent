import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseCameraConfig, type CameraConfig } from '@desk-agent/protocol';

const STORAGE_KEY = 'cameraConfig';

// Fresh installs keep today's behavior: camera presence OFF until the user
// (on the phone, or remotely from the Mac) turns it on. Persisted so it no
// longer resets to OFF on every app restart.
export const DEFAULT_CAMERA_CONFIG: CameraConfig = { enabled: false };

export async function loadCameraConfig(): Promise<CameraConfig> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_CAMERA_CONFIG;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return DEFAULT_CAMERA_CONFIG;
  }
  const result = parseCameraConfig(parsedJson);
  return result.ok ? result.value : DEFAULT_CAMERA_CONFIG;
}

export async function saveCameraConfig(config: CameraConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
