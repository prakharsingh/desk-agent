import { describe, it, expect } from 'vitest';
import {
  buildFaceVisibleFrame,
  buildGazeFrame,
  buildMotionFrame,
  buildCameraStateFrame,
  buildOverrideFrame,
  buildScreensaverConfigFrame,
  buildDeckPressFrame,
  buildDeckBuiltinFrame,
} from './presenceEvents.js';

describe('buildFaceVisibleFrame', () => {
  it('builds an event.publish frame for sensor.face_visible', () => {
    const frame = buildFaceVisibleFrame(true);
    expect(frame.type).toBe('event.publish');
    expect(frame.payload).toEqual({ eventName: 'sensor.face_visible', data: { visible: true } });
  });
});

describe('buildGazeFrame', () => {
  it('builds an event.publish frame for sensor.gaze_at_screen', () => {
    const frame = buildGazeFrame(false);
    expect(frame.payload).toEqual({ eventName: 'sensor.gaze_at_screen', data: { gazing: false } });
  });
});

describe('buildMotionFrame', () => {
  it('builds an event.publish frame for sensor.motion', () => {
    const frame = buildMotionFrame(true);
    expect(frame.payload).toEqual({ eventName: 'sensor.motion', data: { active: true } });
  });
});

describe('buildCameraStateFrame', () => {
  it('builds an event.publish frame for sensor.camera_state without a reason', () => {
    const frame = buildCameraStateFrame('active');
    expect(frame.payload).toEqual({ eventName: 'sensor.camera_state', data: { state: 'active' } });
  });

  it('builds an event.publish frame for sensor.camera_state with a reason', () => {
    const frame = buildCameraStateFrame('error', 'permission-denied');
    expect(frame.payload).toEqual({ eventName: 'sensor.camera_state', data: { state: 'error', reason: 'permission-denied' } });
  });
});

describe('buildOverrideFrame', () => {
  it('builds an event.publish frame for automation.override', () => {
    const frame = buildOverrideFrame(true);
    expect(frame.type).toBe('event.publish');
    expect(frame.payload).toEqual({ eventName: 'automation.override', data: { enabled: true } });
  });
});

describe('buildScreensaverConfigFrame', () => {
  it('builds an event.publish frame for screensaver.config', () => {
    const frame = buildScreensaverConfigFrame({ enabled: false, graceMs: 60000 });
    expect(frame.type).toBe('event.publish');
    expect(frame.payload).toEqual({ eventName: 'screensaver.config', data: { enabled: false, graceMs: 60000 } });
  });
});

describe('buildDeckPressFrame', () => {
  it('builds an action.invoke frame targeting the deck plugin press action', () => {
    const frame = buildDeckPressFrame('focus', 5);
    expect(frame.type).toBe('action.invoke');
    expect(frame.payload).toEqual({ pluginId: 'deck', action: 'press', args: { buttonId: 'focus', seq: 5 } });
  });
});

describe('buildDeckBuiltinFrame', () => {
  it('builds an action.invoke frame with args when provided', () => {
    const frame = buildDeckBuiltinFrame('system-stats', 'togglePlayPause', { foo: 'bar' });
    expect(frame.type).toBe('action.invoke');
    expect(frame.payload).toEqual({ pluginId: 'system-stats', action: 'togglePlayPause', args: { foo: 'bar' } });
  });

  it('omits args entirely when not provided', () => {
    const frame = buildDeckBuiltinFrame('energy-saver', 'sleep');
    expect(frame.payload).toEqual({ pluginId: 'energy-saver', action: 'sleep' });
  });
});
