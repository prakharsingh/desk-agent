import { z } from 'zod';
import { WIDGET_IDS } from '@desk-agent/protocol';

// Node-free by design: only `zod` and @desk-agent/protocol (itself
// Node-free -- only `zod`). This is the one config module both the core
// (Node) and the Electron renderer (browser context, no node:fs/
// node:child_process/node:worker_threads) can import directly -- see
// docs/superpowers/specs/2026-07-13-phase0-control-channel-contract.md for
// why that separation had to be pulled out of packages/core/configLoader.ts.

export const PresenceConfigSchema = z.object({
  absenceTimeoutMs: z.number().default(300_000),
  gazeIsKeepAwake: z.boolean().default(true),
  bootConfirmationTimeoutMs: z.number().default(300_000),
  wakeEnabled: z.boolean().default(true),
});

export const WeatherConfigSchema = z.object({
  // No apiKey: the weather plugin uses Open-Meteo, which needs no API key.
  location: z.string().default('Seattle'),
  // Field name matches WeatherPluginConfig.intervalMs exactly -- this object
  // is passed straight through to createWeatherPlugin() as its config
  // (packages/core/src/main.ts's registry sets configKey: 'weather').
  intervalMs: z.number().default(600_000),
});

export const SystemStatsConfigSchema = z.object({
  // Informational only for now -- the plugin still polls on its own
  // hardcoded POLL_MS; there is no registry configKey wiring this through
  // yet. Exists so the Plugins pane has something real to display per the
  // design mockup (which shows this as read-only, not an editable field).
  pollIntervalMs: z.number().default(2000),
});

export const EnergySaverConfigSchema = z.object({
  // Informational only for now, same reasoning as SystemStatsConfigSchema:
  // the plugin's pmset/caffeinate actions are still hardcoded.
  idleAction: z.string().default('displaysleepnow'),
});

export const ConfigSchema = z.object({
  enabledPlugins: z.array(z.string()).default(['system-stats', 'weather', 'energy-saver']),
  weather: WeatherConfigSchema.default({}),
  systemStats: SystemStatsConfigSchema.default({}),
  energySaver: EnergySaverConfigSchema.default({}),
  presenceDebounceMs: z.number().default(30000),
  wsPort: z.number().default(8787),
  presence: PresenceConfigSchema.default({}),
  // Was a hardcoded WATCHDOG_TIMEOUT_MS constant in main.ts. The phone acks
  // every wsGateway heartbeat (broadcast every heartbeatMs=5000ms)
  // independent of sensor-edge activity, which is what makes this a safe
  // genuine link-liveness signal even during a real, quiet absence. 30s
  // gives a comfortable ~6x margin over that 5s ack cadence before
  // concluding the link is actually dead. Bounded now that this is
  // config-writable (it used to be an unconfigurable constant, so it had no
  // way to be wrong): a value at/below the 5s heartbeat leaves no real
  // margin and can fire false "link dead" errors continuously (setTimeout
  // clamps a zero/negative delay to ~1ms, so it never meaningfully waits);
  // an unbounded-large value would silently disable the watchdog altogether
  // -- the exact "silently-killed phone causes a false-absent sleep"
  // scenario this exists to catch.
  watchdogTimeoutMs: z.number().min(10_000).max(300_000).default(30000),
  // Whether TunnelSupervisor should launch the Android app (adb shell am
  // start) after re-issuing adb reverse on device attach -- see
  // TunnelSupervisor's constructor default. Session-scoped like
  // enabledPlugins's runtime counterpart automationEngine.isEnabled(): the
  // Device pane toggle mutates this live via ControlChannel, not by writing
  // config.json, so this field is only the value at core-boot time.
  launchAppOnDock: z.boolean().default(true),
  // Which phone-dashboard tiles are shown, per the Widgets pane. Sent to the
  // phone in the hello-reply's widget.update frame (see
  // packages/core/src/wsGateway.ts); app/src/display/HomeScreen.tsx
  // conditionally renders each tile against this list. Roadmap-only tiles
  // (Voice, Steam Deck) aren't in WIDGET_IDS at all -- they're always shown,
  // always disabled, never toggleable.
  visibleWidgets: z.array(z.string()).default([...WIDGET_IDS]),
  // Widget ids this config has already been reconciled against (see
  // reconcileWidgets): an id in WIDGET_IDS but not here is "new" to this
  // install and gets switched on once. Fresh configs know every current id.
  knownWidgets: z.array(z.string()).default([...WIDGET_IDS]),
  // Phone-as-extended-display: USB vendor/product ids the helper gives the
  // virtual display (spike-proven defaults).
  display: z
    .object({
      vendorId: z.number().int().min(1).max(0xffff).default(0x3456),
      productId: z.number().int().min(1).max(0xffff).default(0x4d44),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type PresenceConfig = z.infer<typeof PresenceConfigSchema>;

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}

// The widget ids that existed before `knownWidgets` was introduced (i.e. before
// `display`). Treated as already-known for configs that lack the field. Never
// remove an id from this list.
export const LEGACY_KNOWN_WIDGETS = ['clock', 'system', 'weather', 'presence', 'playing', 'light'] as const;

// Switches new widget tiles on exactly once for existing installs. Works on the
// RAW config JSON: a parsed Config would already have defaulted knownWidgets and
// hide the migration. Ids in WIDGET_IDS missing from knownWidgets are appended
// to visibleWidgets (when it is an array) and to knownWidgets; a tile the user
// hid while it was known stays hidden. Pure: never mutates `raw`.
export function reconcileWidgets(raw: Record<string, unknown>): { changed: boolean; next: Record<string, unknown> } {
  const hadKnown = Array.isArray(raw.knownWidgets);
  const known: string[] = hadKnown ? [...(raw.knownWidgets as string[])] : [...LEGACY_KNOWN_WIDGETS];
  const added = WIDGET_IDS.filter((id) => !known.includes(id));

  const next: Record<string, unknown> = { ...raw, knownWidgets: [...known, ...added] };
  if (Array.isArray(raw.visibleWidgets)) {
    const visible = raw.visibleWidgets as string[];
    next.visibleWidgets = [...visible, ...added.filter((id) => !visible.includes(id))];
  }
  return { changed: !hadKnown || added.length > 0, next };
}
