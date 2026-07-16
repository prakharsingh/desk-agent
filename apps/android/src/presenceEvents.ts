import { createFrame, type Frame, type CameraStatePayload, type ScreensaverConfig } from '@desk-agent/protocol';

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

export function buildDeckPressFrame(buttonId: string, seq: number): Frame {
  return createFrame('action.invoke', { pluginId: 'deck', action: 'press', args: { buttonId, seq } });
}

export function buildDeckBuiltinFrame(pluginId: string, action: string, args?: Record<string, unknown>): Frame {
  return createFrame('action.invoke', { pluginId, action, ...(args ? { args } : {}) });
}
