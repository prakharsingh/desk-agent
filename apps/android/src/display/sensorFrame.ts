export type CameraState = 'active' | 'released' | 'error';

export interface SensorFrame {
  faceVisible: boolean | null;
  gaze: boolean | null;
  motion: boolean | null;
  cameraState: CameraState | null;
}

export const UNKNOWN_SENSOR_FRAME: SensorFrame = {
  faceVisible: null,
  gaze: null,
  motion: null,
  cameraState: null,
};

export function mergeSensorFrame(prev: SensorFrame, partial: Partial<SensorFrame>): SensorFrame {
  return { ...prev, ...partial };
}

export function resetSensorFrame(): SensorFrame {
  return UNKNOWN_SENSOR_FRAME;
}
