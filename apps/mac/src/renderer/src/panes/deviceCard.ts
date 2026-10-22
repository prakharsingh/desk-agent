import type { StatusSnapshot } from '@desk-agent/core';

/**
 * Device pane card title: the phone's real model name (resolved core-side via
 * `adb getprop` on attach), "Android phone" until/unless the core knows it,
 * and "No device paired" when nothing is attached over adb.
 */
export function deviceCardTitle(device: Pick<StatusSnapshot['device'], 'serial' | 'model'>): string {
  if (!device.serial) return 'No device paired';
  const model = device.model?.trim();
  return model ? model : 'Android phone';
}
