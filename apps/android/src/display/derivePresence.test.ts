import { describe, it, expect } from 'vitest';
import { derivePresence } from './derivePresence.js';
import { UNKNOWN_SENSOR_FRAME } from './sensorFrame.js';

describe('derivePresence — fail toward UNKNOWN, never a false AWAY', () => {
  it('camera disabled -> UNKNOWN regardless of frame', () => {
    expect(derivePresence({ faceVisible: false, gaze: false, motion: false, cameraState: 'active' }, false).label).toBe('UNKNOWN');
  });

  it('camera enabled but never reported a state (null) -> UNKNOWN', () => {
    expect(derivePresence(UNKNOWN_SENSOR_FRAME, true).label).toBe('UNKNOWN');
  });

  it('camera released -> UNKNOWN even with stale positive signals', () => {
    expect(derivePresence({ faceVisible: true, gaze: true, motion: true, cameraState: 'released' }, true).label).toBe('UNKNOWN');
  });

  it('camera error -> UNKNOWN even with stale positive signals', () => {
    expect(derivePresence({ faceVisible: true, gaze: true, motion: true, cameraState: 'error' }, true).label).toBe('UNKNOWN');
  });

  it('camera active + face visible -> PRESENT', () => {
    expect(derivePresence({ faceVisible: true, gaze: null, motion: null, cameraState: 'active' }, true).label).toBe('PRESENT');
  });

  it('camera active + motion only -> PRESENT', () => {
    expect(derivePresence({ faceVisible: false, gaze: null, motion: true, cameraState: 'active' }, true).label).toBe('PRESENT');
  });

  it('camera active + face and motion both explicitly false -> AWAY', () => {
    expect(derivePresence({ faceVisible: false, gaze: false, motion: false, cameraState: 'active' }, true).label).toBe('AWAY');
  });

  it('camera active + face known false but motion unknown -> UNKNOWN, not AWAY', () => {
    expect(derivePresence({ faceVisible: false, gaze: null, motion: null, cameraState: 'active' }, true).label).toBe('UNKNOWN');
  });

  it('camera active + motion known false but face unknown -> UNKNOWN, not AWAY', () => {
    expect(derivePresence({ faceVisible: null, gaze: null, motion: false, cameraState: 'active' }, true).label).toBe('UNKNOWN');
  });

  it('camera state null (never reported) -> UNKNOWN even with stale positive signals', () => {
    expect(derivePresence({ faceVisible: true, gaze: true, motion: true, cameraState: null }, true).label).toBe('UNKNOWN');
  });

  it('PRESENT and AWAY carry distinct colors from UNKNOWN', () => {
    const present = derivePresence({ faceVisible: true, gaze: null, motion: null, cameraState: 'active' }, true);
    const away = derivePresence({ faceVisible: false, gaze: false, motion: false, cameraState: 'active' }, true);
    const unknown = derivePresence(UNKNOWN_SENSOR_FRAME, true);
    expect(new Set([present.color, away.color, unknown.color]).size).toBe(3);
  });
});
