import { useEffect, useState } from 'react';
import { useCameraPermission } from 'react-native-vision-camera';

export type CameraLifecycleState = 'idle' | 'requesting' | 'granted' | 'denied';

/**
 * NOTE ON API VERSION: the task brief's reference code called a static
 * `Camera.requestCameraPermission()` method returning a `CameraPermissionStatus`
 * ('granted' | 'denied' | ...). Neither exists on this project's pinned
 * VisionCamera v5.1.0 -- `views/Camera.d.ts` exposes no static permission
 * methods at all, and `specs/common-types/PermissionStatus.d.ts` defines a
 * different four-value union: 'not-determined' | 'authorized' | 'denied' |
 * 'restricted'. Permissions are requested exclusively via the
 * `useCameraPermission()` hook (`hooks/usePermission.ts`), which returns
 * `{ status, hasPermission, canRequestPermission, requestPermission() }`.
 * This mirrors the same kind of v3/v4-vs-v5 API drift Task C2 found for
 * frame processors -- verified directly against
 * `node_modules/react-native-vision-camera/lib/hooks/usePermission.d.ts` and
 * `.../specs/common-types/PermissionStatus.d.ts` before writing this hook.
 */
export function useCameraLifecycle(enabled: boolean): CameraLifecycleState {
  const [state, setState] = useState<CameraLifecycleState>('idle');
  const { status, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }
    if (status === 'authorized') {
      setState('granted');
      return;
    }
    if (status === 'denied' || status === 'restricted') {
      setState('denied');
      return;
    }
    // status === 'not-determined': prompt the user.
    let cancelled = false;
    setState('requesting');
    (async () => {
      const granted = await requestPermission();
      if (cancelled) return;
      setState(granted ? 'granted' : 'denied');
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, status, requestPermission]);

  return state;
}
