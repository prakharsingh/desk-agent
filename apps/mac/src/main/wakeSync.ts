import { ConfigSchema, type Config } from '@desk-agent/config-schema';
import type { ToApp, ToCore } from '@desk-agent/core';
import { readConfig, writeConfig } from './configStore.js';

export interface WakeSyncDeps {
  configPath: string;
  sendToCore: (msg: ToCore) => void;
  /** Push the freshly-persisted config to the renderer so useConfig reflects a phone-originated change. */
  notifyRenderer: (config: Config) => void;
}

// presence.wakeEnabled is Mac-owned (config.json is the source of truth) but
// is applied LIVE by core (packages/core/src/wakeSetting.ts) -- so unlike
// every other config:set field, this path persists WITHOUT scheduling a core
// restart. Deliberately has no access to the supervisor/restart at all.
//
// Ordering: core is the serialization point. It reports EVERY applied change
// (Mac- or phone-sourced) as ToApp wakeEnabledChanged, in apply order, and
// this persists whatever core last reported. The Mac path's own write is
// only optimistic (so the renderer and a not-yet-running core see it at
// once); core's subsequent report of the same value is an equal write and
// skipped, while an interleaved phone change is followed by core's report of
// whichever value it applied LAST -- so config.json always ends equal to core.
export class WakeSync {
  constructor(private deps: WakeSyncDeps) {}

  /** Mac UI toggle: optimistic persist, then tell the running core (which pushes it to the phone and reports it back). */
  setFromMac(enabled: boolean): Config {
    const { config } = this.persist(enabled);
    this.deps.sendToCore({ kind: 'setWakeEnabled', enabled });
    return config;
  }

  /**
   * config:set from the renderer: write everything EXCEPT presence.wakeEnabled,
   * which is kept at its on-disk value. The renderer only ever changes wake via
   * setFromMac, so whatever wake value a full-config save carries is at best a
   * copy of disk and at worst stale (a phone toggle persisted after the
   * renderer's last configChanged) -- writing it would silently undo the phone.
   * Throws (without touching disk) if `config` fails ConfigSchema validation.
   */
  writeRendererConfig(config: unknown): Config {
    const validated = ConfigSchema.parse(config);
    let wakeEnabled = validated.presence.wakeEnabled;
    try {
      wakeEnabled = readConfig(this.deps.configPath).presence.wakeEnabled;
    } catch {
      // Unreadable/invalid on-disk config: nothing to preserve, so the
      // renderer's (validated) value is the best available.
    }
    return writeConfig(this.deps.configPath, { ...validated, presence: { ...validated.presence, wakeEnabled } });
  }

  /** Returns true if `msg` was a core wake report (persisted if it differs, and then forwarded to the renderer). */
  handleCoreMessage(msg: ToApp): boolean {
    if (msg.kind !== 'wakeEnabledChanged') return false;
    const { config, changed } = this.persist(msg.enabled);
    if (changed) this.deps.notifyRenderer(config);
    return true;
  }

  private persist(enabled: boolean): { config: Config; changed: boolean } {
    const current = readConfig(this.deps.configPath);
    if (current.presence.wakeEnabled === enabled) return { config: current, changed: false };
    return { config: writeConfig(this.deps.configPath, { ...current, presence: { ...current.presence, wakeEnabled: enabled } }), changed: true };
  }
}
