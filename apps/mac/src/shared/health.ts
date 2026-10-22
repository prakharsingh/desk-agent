import type { StatusSnapshot } from '@desk-agent/core';

// Pure (type import + plain logic, no Node built-ins) so both the main
// process (tray) and the sandboxed renderer (Overview) can import it.
export type CoreHealth = 'starting' | 'running' | 'crashed' | 'stopped';

export type HealthTone = 'green' | 'amber' | 'red';

/**
 * Short core-process label, shared by the tray's status item and the
 * settings sidebar footer so both read identically ("Core running").
 */
export function coreHealthLabel(health: CoreHealth | 'unknown'): string {
  switch (health) {
    case 'running':
      return 'Core running';
    case 'starting':
      return 'Core starting…';
    case 'stopped':
      return 'Core stopped';
    case 'crashed':
      return 'Core crashed';
    default:
      return 'Checking core…';
  }
}

/**
 * Tone for the core PROCESS alone (Overview's "Core agent" row) -- distinct
 * from overallHealth(), which also folds in phone/tunnel state.
 */
export function coreHealthTone(health: CoreHealth | 'unknown'): HealthTone {
  if (health === 'running') return 'green';
  if (health === 'crashed') return 'red';
  return 'amber';
}

export interface OverallHealth {
  tone: HealthTone;
  text: string;
}

/**
 * The single "is Desk Agent healthy?" rule, shared by the tray's status dot
 * and the Overview pane's headline so the two can never disagree. Core health
 * is checked first: a snapshot is only meaningful while the core is running
 * (a stale one from before a crash must not read as healthy). Only green when
 * the phone app is actually connected -- an adb-attached phone stuck on an RN
 * error screen must not read as "healthy".
 *
 * `health` may be 'unknown' in the renderer before its first core-health poll.
 */
export function overallHealth(health: CoreHealth | 'unknown', snapshot: StatusSnapshot | null): OverallHealth {
  if (health === 'crashed') return { tone: 'red', text: 'core crashed' };
  if (health === 'starting') return { tone: 'amber', text: 'core starting…' };
  if (health === 'stopped') return { tone: 'amber', text: 'core stopped' };
  if (health !== 'running') return { tone: 'amber', text: 'checking core…' };
  if (!snapshot) return { tone: 'amber', text: 'waiting for the core to report in…' };
  if (snapshot.device.tunnelStatus === 'failed') return { tone: 'red', text: 'adb tunnel failed' };
  // clients.connected counts every WS client on 127.0.0.1:8787, not just the
  // phone app -- today the phone app is the only thing that connects there.
  if (snapshot.clients.connected === 0) return { tone: 'amber', text: 'phone app not connected' };
  return { tone: 'green', text: 'all systems healthy' };
}
