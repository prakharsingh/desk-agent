import { describe, it, expect, vi } from 'vitest';
import { ScreensaverConfigStore } from './screensaverConfigStore.js';

describe('ScreensaverConfigStore', () => {
  it('starts with no status (null) until the phone reports its first-ever config', () => {
    const store = new ScreensaverConfigStore(vi.fn());
    expect(store.getStatus()).toBeNull();
  });

  it('setConfig updates the status to the given config', () => {
    const store = new ScreensaverConfigStore(vi.fn());
    store.setConfig({ enabled: false, graceMs: 60000 });
    expect(store.getStatus()).toEqual({ enabled: false, graceMs: 60000 });
  });

  it('setConfig invokes the onChange callback', () => {
    const onChange = vi.fn();
    const store = new ScreensaverConfigStore(onChange);
    store.setConfig({ enabled: true, graceMs: 120000 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a later setConfig call overwrites the previous status', () => {
    const store = new ScreensaverConfigStore(vi.fn());
    store.setConfig({ enabled: true, graceMs: 120000 });
    store.setConfig({ enabled: false, graceMs: 300000 });
    expect(store.getStatus()).toEqual({ enabled: false, graceMs: 300000 });
  });
});
