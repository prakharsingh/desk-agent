import { renderHook, act, waitFor } from '@testing-library/react-native';

const mockStorage = new Map<string, string>();
let mockGetItemRejects = false;
let mockSetItemRejects = false;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) =>
      mockGetItemRejects ? Promise.reject(new Error('AsyncStorage unavailable')) : Promise.resolve(mockStorage.get(key) ?? null),
    ),
    setItem: jest.fn((key: string, value: string) => {
      if (mockSetItemRejects) return Promise.reject(new Error('AsyncStorage full'));
      mockStorage.set(key, value);
      return Promise.resolve();
    }),
  },
}));

import { useCameraSetting, useWakeSetting } from './usePresenceSettings.js';

function published(sendFrame: jest.Mock) {
  return sendFrame.mock.calls.map(([json]) => JSON.parse(json).payload);
}

beforeEach(() => {
  mockStorage.clear();
  mockGetItemRejects = false;
  mockSetItemRejects = false;
});

describe('useCameraSetting', () => {
  it('is null (camera not started) until the persisted value loads, then loads it on start', async () => {
    mockStorage.set('cameraConfig', JSON.stringify({ enabled: true }));
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useCameraSetting({ sendFrame, connectionEpoch: 0 }));
    await waitFor(() => expect(result.current.cameraEnabled).toBe(true));
  });

  it('falls back to the default (false) instead of staying null forever when AsyncStorage rejects, and still publishes it', async () => {
    mockGetItemRejects = true;
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useCameraSetting({ sendFrame, connectionEpoch: 0 }));
    await waitFor(() => expect(result.current.cameraEnabled).toBe(false));
    expect(published(sendFrame)).toContainEqual({ eventName: 'presence.cameraConfig', data: { enabled: false } });
  });

  it('defaults to false on a fresh install', async () => {
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useCameraSetting({ sendFrame, connectionEpoch: 0 }));
    await waitFor(() => expect(result.current.cameraEnabled).toBe(false));
  });

  it('publishes presence.cameraConfig once loaded, and again on every reconnect', async () => {
    mockStorage.set('cameraConfig', JSON.stringify({ enabled: true }));
    const sendFrame = jest.fn();
    const { rerender } = await renderHook((props: { epoch: number }) => useCameraSetting({ sendFrame, connectionEpoch: props.epoch }), {
      initialProps: { epoch: 0 },
    });
    await waitFor(() => expect(published(sendFrame)).toContainEqual({ eventName: 'presence.cameraConfig', data: { enabled: true } }));
    const before = sendFrame.mock.calls.length;
    await rerender({ epoch: 1 });
    expect(sendFrame.mock.calls.length).toBe(before + 1);
    expect(published(sendFrame).at(-1)).toEqual({ eventName: 'presence.cameraConfig', data: { enabled: true } });
  });

  it('setCameraEnabled persists the new value and publishes it', async () => {
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useCameraSetting({ sendFrame, connectionEpoch: 0 }));
    await waitFor(() => expect(result.current.cameraEnabled).toBe(false));
    await act(async () => result.current.setCameraEnabled(true));
    expect(result.current.cameraEnabled).toBe(true);
    expect(JSON.parse(mockStorage.get('cameraConfig')!)).toEqual({ enabled: true });
    expect(published(sendFrame).at(-1)).toEqual({ eventName: 'presence.cameraConfig', data: { enabled: true } });
  });

  it('a failed AsyncStorage write is logged, not an unhandled rejection, and the toggle still applies', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const sendFrame = jest.fn();
      const { result } = await renderHook(() => useCameraSetting({ sendFrame, connectionEpoch: 0 }));
      await waitFor(() => expect(result.current.cameraEnabled).toBe(false));
      mockSetItemRejects = true;
      await act(async () => result.current.setCameraEnabled(true));
      expect(result.current.cameraEnabled).toBe(true);
      await waitFor(() => expect(warn).toHaveBeenCalledWith('[usePresenceSettings] saveCameraConfig failed:', expect.any(Error)));
      expect(published(sendFrame).at(-1)).toEqual({ eventName: 'presence.cameraConfig', data: { enabled: true } });
    } finally {
      warn.mockRestore();
    }
  });

  it('a value applied (e.g. from the Mac) before the storage load resolves is not clobbered by the load', async () => {
    mockStorage.set('cameraConfig', JSON.stringify({ enabled: false }));
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useCameraSetting({ sendFrame, connectionEpoch: 0 }));
    await act(async () => result.current.setCameraEnabled(true));
    await act(async () => {});
    expect(result.current.cameraEnabled).toBe(true);
  });
});

describe('useWakeSetting', () => {
  it('is null (unknown) until the Mac pushes a value', async () => {
    const { result } = await renderHook(() => useWakeSetting({ sendFrame: jest.fn() }));
    expect(result.current.wakeEnabled).toBeNull();
  });

  it('applyFromMac sets the value without echoing a frame back', async () => {
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useWakeSetting({ sendFrame }));
    await act(async () => result.current.applyFromMac(true));
    expect(result.current.wakeEnabled).toBe(true);
    expect(sendFrame).not.toHaveBeenCalled();
  });

  it('toggle flips the value and publishes presence.wakeEnabled to the Mac', async () => {
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useWakeSetting({ sendFrame }));
    await act(async () => result.current.applyFromMac(true));
    await act(async () => result.current.toggle());
    expect(result.current.wakeEnabled).toBe(false);
    expect(published(sendFrame)).toEqual([{ eventName: 'presence.wakeEnabled', data: { enabled: false } }]);
  });

  it('toggle is a no-op while the value is still unknown', async () => {
    const sendFrame = jest.fn();
    const { result } = await renderHook(() => useWakeSetting({ sendFrame }));
    await act(async () => result.current.toggle());
    expect(result.current.wakeEnabled).toBeNull();
    expect(sendFrame).not.toHaveBeenCalled();
  });
});
