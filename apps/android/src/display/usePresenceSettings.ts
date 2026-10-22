import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_CAMERA_CONFIG, loadCameraConfig, saveCameraConfig } from './cameraConfig.js';
import { buildCameraConfigFrame, buildWakeEnabledFrame } from '../presenceEvents.js';

// Camera presence: PHONE-owned, persisted in AsyncStorage. Mirrors App.tsx's
// screensaver-config handling:
// - null until the persisted value loads (callers treat null as "camera off",
//   so CameraPresence never starts on a guess);
// - published to the Mac (event.publish presence.cameraConfig) whenever it
//   changes AND on every reconnect (connectionEpoch). A send before the
//   socket is open is dropped by WsClient and re-sent on the next epoch.
export function useCameraSetting({ sendFrame, connectionEpoch }: { sendFrame: (json: string) => void; connectionEpoch: number }) {
  const [cameraEnabled, setState] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCameraConfig()
      // A rejected AsyncStorage read must not leave this null forever (camera
      // presence would silently never start and never be reported).
      .catch(() => DEFAULT_CAMERA_CONFIG)
      .then((config) => {
        // Don't clobber a value applied (locally or from the Mac) while the
        // load was in flight.
        if (!cancelled) setState((prev) => (prev === null ? config.enabled : prev));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (cameraEnabled !== null) sendFrame(JSON.stringify(buildCameraConfigFrame(cameraEnabled)));
  }, [cameraEnabled, connectionEpoch, sendFrame]);

  const setCameraEnabled = useCallback((enabled: boolean) => {
    setState(enabled);
    // A failed AsyncStorage write must not surface as an unhandled rejection;
    // the in-memory value (and the Mac) still reflect the toggle this session.
    saveCameraConfig({ enabled }).catch((err: unknown) => console.warn('[usePresenceSettings] saveCameraConfig failed:', err));
  }, []);

  return { cameraEnabled, setCameraEnabled };
}

// Monitor wake on return: MAC-owned (config.json). Not persisted here -- core
// pushes the live value (action.invoke phone-display/setWakeEnabled) after
// every hello and on every change, so null means "Mac hasn't told us yet".
// A local toggle is optimistic and sent as event.publish presence.wakeEnabled;
// core applies it and re-broadcasts the authoritative value back.
export function useWakeSetting({ sendFrame }: { sendFrame: (json: string) => void }) {
  const [wakeEnabled, setWakeEnabled] = useState<boolean | null>(null);

  const applyFromMac = useCallback((enabled: boolean) => setWakeEnabled(enabled), []);

  const toggle = useCallback(() => {
    if (wakeEnabled === null) return;
    const next = !wakeEnabled;
    setWakeEnabled(next);
    sendFrame(JSON.stringify(buildWakeEnabledFrame(next)));
  }, [wakeEnabled, sendFrame]);

  return { wakeEnabled, applyFromMac, toggle };
}
