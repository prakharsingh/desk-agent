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

import { DEFAULT_SCREENSAVER_CONFIG, loadScreensaverConfig, saveScreensaverConfig } from './screensaverConfig.js';

beforeEach(() => storage.clear());

describe('loadScreensaverConfig', () => {
  it('returns the default when nothing is persisted', async () => {
    expect(await loadScreensaverConfig()).toEqual(DEFAULT_SCREENSAVER_CONFIG);
  });

  it('returns the persisted value when present and valid', async () => {
    storage.set('screensaverConfig', JSON.stringify({ enabled: false, graceMs: 60000 }));
    expect(await loadScreensaverConfig()).toEqual({ enabled: false, graceMs: 60000 });
  });

  it('falls back to the default when the persisted value fails schema validation', async () => {
    storage.set('screensaverConfig', JSON.stringify({ enabled: 'nope' }));
    expect(await loadScreensaverConfig()).toEqual(DEFAULT_SCREENSAVER_CONFIG);
  });

  it('falls back to the default when the persisted value is not valid JSON', async () => {
    storage.set('screensaverConfig', 'not json');
    expect(await loadScreensaverConfig()).toEqual(DEFAULT_SCREENSAVER_CONFIG);
  });
});

describe('saveScreensaverConfig', () => {
  it('persists the config so a subsequent load returns it', async () => {
    await saveScreensaverConfig({ enabled: false, graceMs: 300000 });
    expect(await loadScreensaverConfig()).toEqual({ enabled: false, graceMs: 300000 });
  });
});
