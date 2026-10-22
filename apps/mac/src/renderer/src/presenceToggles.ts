import type { StatusSnapshot } from '@desk-agent/core';

export interface CameraToggleState {
  checked: boolean;
  disabled: boolean;
  hint: string | null;
}

// Camera presence is phone-owned (persisted on the phone), so the Mac toggle
// is a remote control for it: it shows the phone-reported value from the
// snapshot and is only actionable while a phone is connected AND has reported
// -- same rule as DevicePane's screensaver controls.
export function cameraToggleState(snapshot: StatusSnapshot | null): CameraToggleState {
  if (!snapshot) return { checked: false, disabled: true, hint: 'Waiting for core to report in…' };
  const camera = snapshot.camera;
  if (snapshot.clients.connected === 0) {
    return { checked: camera?.enabled ?? false, disabled: true, hint: 'Phone not connected — this setting lives on the phone.' };
  }
  if (!camera) return { checked: false, disabled: true, hint: 'Waiting for the phone to report its camera setting…' };
  return { checked: camera.enabled, disabled: false, hint: null };
}
