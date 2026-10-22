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
};

export interface DisplayEventHandlers {
  onState: (e: { state: string; reason?: string; inputEnabled?: boolean }) => void;
  onSize: (e: { w: number; h: number; orientation: DisplayOrientation; dpi?: number }) => void;
}

export function subscribeDisplayEvents(h: DisplayEventHandlers): () => void {
  const native = NativeModules.DisplayModule;
  if (!native) return () => {};
  const emitter = new NativeEventEmitter(native);
  const subs = [emitter.addListener('DisplayState', h.onState), emitter.addListener('DisplaySurfaceSize', h.onSize)];
  return () => subs.forEach((s) => s.remove());
}
