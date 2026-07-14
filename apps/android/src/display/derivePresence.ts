import type { SensorFrame } from './sensorFrame.js';
import { theme } from './theme.js';

export interface PresenceView {
  label: 'PRESENT' | 'AWAY' | 'UNKNOWN';
  color: string;
  note: string;
}

export function derivePresence(frame: SensorFrame, cameraEnabled: boolean): PresenceView {
  if (!cameraEnabled) {
    return { label: 'UNKNOWN', color: theme.colors.textFaint, note: 'Detection off — failing safe to present, display stays awake.' };
  }
  if (frame.cameraState !== 'active') {
    return { label: 'UNKNOWN', color: theme.colors.textFaint, note: 'Camera not active — failing safe, no presence judgment made.' };
  }
  if (frame.faceVisible === true || frame.motion === true) {
    return { label: 'PRESENT', color: theme.colors.accent, note: 'Local sensor frame shows a positive signal.' };
  }
  if (frame.faceVisible === false && frame.motion === false) {
    return { label: 'AWAY', color: theme.colors.warn, note: 'No face or motion observed locally.' };
  }
  return { label: 'UNKNOWN', color: theme.colors.textFaint, note: 'Incomplete local signal — failing safe, no presence judgment made.' };
}
