import { describe, it, expect, vi } from 'vitest';
import { CameraConfigStore } from './cameraConfigStore.js';

describe('CameraConfigStore', () => {
  it('starts null until the phone reports its camera setting for the first time', () => {
    expect(new CameraConfigStore(vi.fn()).getStatus()).toBeNull();
  });

  it('setConfig stores the phone-reported value and fires onChange (so a snapshot is pushed)', () => {
    const onChange = vi.fn();
    const store = new CameraConfigStore(onChange);
    store.setConfig({ enabled: true });
    expect(store.getStatus()).toEqual({ enabled: true });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a later report overwrites the earlier one', () => {
    const store = new CameraConfigStore(vi.fn());
    store.setConfig({ enabled: true });
    store.setConfig({ enabled: false });
    expect(store.getStatus()).toEqual({ enabled: false });
  });

  describe('phone-client count (stale value from a phone that disconnected)', () => {
    it('clears the mirrored value (back to null) when the last phone client disconnects, and pushes a snapshot', () => {
      const onChange = vi.fn();
      const store = new CameraConfigStore(onChange);
      store.setConfig({ enabled: true });
      onChange.mockClear();
      store.onClientCountChanged(0);
      expect(store.getStatus()).toBeNull();
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('keeps the value while at least one phone client is still connected', () => {
      const onChange = vi.fn();
      const store = new CameraConfigStore(onChange);
      store.setConfig({ enabled: true });
      onChange.mockClear();
      store.onClientCountChanged(1);
      expect(store.getStatus()).toEqual({ enabled: true });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not fire onChange when dropping to 0 with nothing stored', () => {
      const onChange = vi.fn();
      const store = new CameraConfigStore(onChange);
      store.onClientCountChanged(0);
      expect(store.getStatus()).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('an older phone app that never reports camera does not inherit the previous phone\'s value', () => {
      const store = new CameraConfigStore(vi.fn());
      store.onClientCountChanged(1);
      store.setConfig({ enabled: true }); // new phone app reports
      store.onClientCountChanged(0); // it disconnects
      store.onClientCountChanged(1); // old app connects, never publishes presence.cameraConfig
      expect(store.getStatus()).toBeNull();
    });
  });
});
