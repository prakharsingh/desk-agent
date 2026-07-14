# @desk-agent/config-schema

The Zod schema for `config.json`, extracted into its own **Node-free**
package (only `zod` + `@desk-agent/protocol`) so that both the core (Node)
and the macOS app's Electron renderer (a browser context with no `fs`) can
validate and edit the exact same schema. `packages/core/src/configLoader.ts`
re-exports everything here and adds only the file-reading wrapper.

## Schema at a glance (all fields have defaults)

| Field | Default | Notes |
|---|---|---|
| `enabledPlugins` | `['system-stats', 'weather', 'energy-saver']` | must match ids in core's plugin registry |
| `wsPort` | `8787` | gateway binds `127.0.0.1` only |
| `weather.location` | `'Seattle'` | Open-Meteo geocoded; no API key exists or is needed |
| `weather.intervalMs` | `600000` | poll interval |
| `presenceDebounceMs` | `30000` | debounce on the sleep-on-absent automation rule |
| `presence.absenceTimeoutMs` | `300000` | hysteresis window before `maybe-absent → absent` |
| `presence.gazeIsKeepAwake` | `true` | gaze counts as presence-confirming |
| `presence.bootConfirmationTimeoutMs` | `300000` | fail-to-present if the camera never confirms after boot |
| `presence.wakeEnabled` | `true` | disable programmatic wake-on-return independently of auto-sleep |
| `watchdogTimeoutMs` | `30000` | clamped to 10 000–300 000 |
| `launchAppOnDock` | `true` | boot default for auto-launching the phone app on USB attach |
| `visibleWidgets` | all of `WIDGET_IDS` | which widget tiles the phone Home screen renders |
| `systemStats.pollIntervalMs` | `2000` | **informational only** — the plugin currently uses a hardcoded 2 s poll |
| `energySaver.idleAction` | `'displaysleepnow'` | **informational only** — not wired to the plugin |

Only the `weather` block actually flows into a plugin (via the registry's
`configKey`); `systemStats` and `energySaver` are display-only today.

Exports: `ConfigSchema`, `PresenceConfigSchema`, the inferred `Config` /
`PresenceConfig` types, and `parseConfig(raw)`.

## Changing the schema

- New fields must carry a `.default(...)` so existing `config.json` files
  keep parsing — a missing-field boot failure on upgrade is a bug.
- The schema is **not** `.strict()`: unknown keys in a user's config are
  ignored rather than rejected. Keep it that way; it's what makes removing a
  field non-breaking.
- Update `config.example.json` at the repo root in the same PR.
- The Mac app edits config through this schema too (atomic, validate-before-
  write in `apps/mac/src/main/configStore.ts`) and restarts the core on
  change — the core only reads config at boot.

## Build & test

```bash
pnpm --filter @desk-agent/config-schema build
pnpm --filter @desk-agent/config-schema test   # or root `pnpm test`
```
