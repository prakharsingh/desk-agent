import { createFrame, type Frame, type CameraStatePayload } from '@desk-agent/protocol';

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
