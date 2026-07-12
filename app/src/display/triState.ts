import { theme } from './theme.js';
import type { SensorFrame } from './sensorFrame.js';

export interface TriStateDisplay {
  text: string;
  color: string;
}

export function fmtTri(v: boolean | null): TriStateDisplay {
  if (v === true) return { text: 'TRUE', color: theme.colors.accent };
  if (v === false) return { text: 'FALSE', color: theme.colors.textFaint };
  return { text: 'UNKNOWN', color: theme.colors.textFaint };
}

export function fmtCameraState(v: SensorFrame['cameraState']): TriStateDisplay {
  if (v === 'active') return { text: 'ACTIVE', color: theme.colors.accent };
  if (v === 'released') return { text: 'RELEASED', color: theme.colors.textFaint };
  if (v === 'error') return { text: 'ERROR', color: theme.colors.alert };
  return { text: 'UNKNOWN', color: theme.colors.textFaint };
}
