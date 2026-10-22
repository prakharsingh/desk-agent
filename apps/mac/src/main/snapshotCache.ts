import type { StatusSnapshot } from '@desk-agent/core';
import type { CoreHealth } from '../shared/health.js';

/**
 * The main process's cache of the core's latest StatusSnapshot (served to a
 * freshly mounted renderer via status:getSnapshot and read by the tray).
 * A snapshot only describes a *running* core: once the core leaves 'running'
 * (crashed, stopped, restarting) it is cleared, so the tray rows ("Phone app:
 * connected", paired phone, tunnel, presence) and the Overview pane don't keep
 * showing stale data from a core that is no longer there.
 */
export class SnapshotCache {
  private latest: StatusSnapshot | null = null;

  get(): StatusSnapshot | null {
    return this.latest;
  }

  set(snapshot: StatusSnapshot) {
    this.latest = snapshot;
  }

  /** Returns true if a snapshot was cleared, i.e. the renderer must be told. */
  onHealthChange(health: CoreHealth): boolean {
    if (health === 'running' || this.latest === null) return false;
    this.latest = null;
    return true;
  }
}
