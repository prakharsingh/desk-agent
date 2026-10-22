import { createFrame, CAMERA_CONFIG_EVENT, WAKE_ENABLED_EVENT, type Frame, type CameraStatePayload, type ScreensaverConfig } from '@desk-agent/protocol';

export function buildFaceVisibleFrame(visible: boolean): Frame {
  return createFrame('event.publish', { eventName: 'sensor.face_visible', data: { visible } });
}

export function buildGazeFrame(gazing: boolean): Frame {
  return createFrame('event.publish', { eventName: 'sensor.gaze_at_screen', data: { gazing } });
}

export function buildMotionFrame(active: boolean): Frame {
  return createFrame('event.publish', { eventName: 'sensor.motion', data: { active } });
}

export function buildCameraStateFrame(state: CameraStatePayload['state'], reason?: string): Frame {
  return createFrame('event.publish', {
    eventName: 'sensor.camera_state',
    data: reason !== undefined ? { state, reason } : { state },
  });
}

export function buildOverrideFrame(enabled: boolean): Frame {
  return createFrame('event.publish', { eventName: 'automation.override', data: { enabled } });
}

export function buildMediaActionFrame(action: 'togglePlayPause' | 'next' | 'previous'): Frame {
  return createFrame('action.invoke', { pluginId: 'system-stats', action });
}

export function buildScreensaverConfigFrame(config: ScreensaverConfig): Frame {
  return createFrame('event.publish', { eventName: 'screensaver.config', data: config });
}

// Phone-owned camera presence setting, reported to the Mac on change and on
// every reconnect (same pattern as buildScreensaverConfigFrame).
export function buildCameraConfigFrame(enabled: boolean): Frame {
  return createFrame('event.publish', { eventName: CAMERA_CONFIG_EVENT, data: { enabled } });
}

// A phone-side toggle of the Mac-owned Monitor wake setting.
export function buildWakeEnabledFrame(enabled: boolean): Frame {
  return createFrame('event.publish', { eventName: WAKE_ENABLED_EVENT, data: { enabled } });
}
