import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
  },
}));

import { DEFAULT_CAMERA_CONFIG, loadCameraConfig, saveCameraConfig } from './cameraConfig.js';

beforeEach(() => storage.clear());

describe('loadCameraConfig', () => {
  it('defaults to camera OFF for a fresh install', async () => {
    expect(DEFAULT_CAMERA_CONFIG).toEqual({ enabled: false });
    expect(await loadCameraConfig()).toEqual({ enabled: false });
  });

  it('returns the persisted value', async () => {
    storage.set('cameraConfig', JSON.stringify({ enabled: true }));
    expect(await loadCameraConfig()).toEqual({ enabled: true });
  });

  it('falls back to the default on invalid JSON or schema', async () => {
    storage.set('cameraConfig', 'nope');
    expect(await loadCameraConfig()).toEqual(DEFAULT_CAMERA_CONFIG);
    storage.set('cameraConfig', JSON.stringify({ enabled: 'yes' }));
    expect(await loadCameraConfig()).toEqual(DEFAULT_CAMERA_CONFIG);
  });
});

describe('saveCameraConfig', () => {
  it('persists across a subsequent load (survives app restart)', async () => {
    await saveCameraConfig({ enabled: true });
    expect(await loadCameraConfig()).toEqual({ enabled: true });
  });
});
