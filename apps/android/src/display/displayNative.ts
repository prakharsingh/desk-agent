import { NativeEventEmitter, NativeModules, requireNativeComponent, type StyleProp, type ViewStyle } from 'react-native';
import type { DisplayOrientation } from '@desk-agent/protocol';

// Native SurfaceView host for the decoded video (Task 3.6). Takes no props; it
// is sized by its parent style.
export const DisplayView = requireNativeComponent<{ style?: StyleProp<ViewStyle> }>('DeskAgentDisplayView');

interface DisplayNativeModule {
  start(sessionId: string, videoPort: number): void;
  stop(): void;
  requestSize(): void;
  setTrackpadMode(enabled: boolean): void;
  setOrientation?(mode: 'portrait' | 'landscape' | 'unspecified'): void;
}

// Resolved at call time (not import time) so a missing module degrades to a
// no-op instead of crashing on module load.
const mod = (): DisplayNativeModule | undefined => NativeModules.DisplayModule as DisplayNativeModule | undefined;

export const displayNative = {
  start(sessionId: string, videoPort: number): void {
    mod()?.start(sessionId, videoPort);
  },
  stop(): void {
    mod()?.stop();
  },
  // Ask native to re-emit the surface size: it may have reported before we subscribed.
  requestSize(): void {
    mod()?.requestSize();
  },
  setTrackpadMode(enabled: boolean): void {
    mod()?.setTrackpadMode(enabled);
  },
  // The rotate control (displayOverlay.ts): pin portrait/landscape, or hand it back to the sensor.
  setOrientation(mode: 'portrait' | 'landscape' | 'unspecified'): void {
    mod()?.setOrientation?.(mode);
  },
};

export interface DisplayEventHandlers {
  onState: (e: { state: string; reason?: string; inputEnabled?: boolean }) => void;
  onSize: (e: { w: number; h: number; orientation: DisplayOrientation; dpi?: number }) => void;
  /** Each helper streamConfig: the size the Mac streams now. */
  onStream?: (e: { w: number; h: number; orientation: DisplayOrientation }) => void;
}

export function subscribeDisplayEvents(h: DisplayEventHandlers): () => void {
  const native = NativeModules.DisplayModule;
  if (!native) return () => {};
  const emitter = new NativeEventEmitter(native);
  const subs = [emitter.addListener('DisplayState', h.onState), emitter.addListener('DisplaySurfaceSize', h.onSize)];
  if (h.onStream) subs.push(emitter.addListener('DisplayStreamSize', h.onStream));
  return () => subs.forEach((s) => s.remove());
}
