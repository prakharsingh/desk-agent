import type { StatusSnapshot } from '@desk-agent/core';

/** "Paired phone" value: the model name core resolved (e.g. "OnePlus 6T"), else the adb serial, else "none". */
export function pairedPhoneName(device: Pick<StatusSnapshot['device'], 'serial' | 'model'>): string {
  const model = device.model?.trim();
  return model || device.serial || 'none';
}

/**
 * "Phone app" value. clients.connected counts every WS client on
 * 127.0.0.1:8787; today only the phone app connects there.
 */
export function phoneAppLabel(clients: Pick<StatusSnapshot['clients'], 'connected'>): string {
  return clients.connected > 0 ? 'connected' : 'not connected';
}
