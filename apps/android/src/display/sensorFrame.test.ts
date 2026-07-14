import { describe, it, expect } from 'vitest';
import { UNKNOWN_SENSOR_FRAME, mergeSensorFrame, resetSensorFrame } from './sensorFrame.js';

describe('sensorFrame', () => {
  it('UNKNOWN_SENSOR_FRAME has all fields unknown/null', () => {
    expect(UNKNOWN_SENSOR_FRAME).toEqual({ faceVisible: null, gaze: null, motion: null, cameraState: null });
  });

  it('mergeSensorFrame overlays only the provided partial fields', () => {
    const merged = mergeSensorFrame(UNKNOWN_SENSOR_FRAME, { faceVisible: true });
    expect(merged).toEqual({ faceVisible: true, gaze: null, motion: null, cameraState: null });
  });

  it('mergeSensorFrame preserves prior fields not present in the partial', () => {
    const step1 = mergeSensorFrame(UNKNOWN_SENSOR_FRAME, { faceVisible: true, cameraState: 'active' });
    const step2 = mergeSensorFrame(step1, { motion: false });
    expect(step2).toEqual({ faceVisible: true, gaze: null, motion: false, cameraState: 'active' });
  });

  it('resetSensorFrame returns a fresh unknown snapshot', () => {
    expect(resetSensorFrame()).toEqual(UNKNOWN_SENSOR_FRAME);
  });
});
