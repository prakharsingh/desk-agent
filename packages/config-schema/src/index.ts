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
});

export type Config = z.infer<typeof ConfigSchema>;
export type PresenceConfig = z.infer<typeof PresenceConfigSchema>;

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}
