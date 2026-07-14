# Built-in plugins

Each plugin is its own workspace package, runs in its own `worker_thread`,
and reaches the outside world only through the capability object (`ctx`) —
see [`@desk-agent/plugin-sdk`](../plugin-sdk/README.md) for the contract and
[docs/guides/writing-a-plugin.md](../../docs/guides/writing-a-plugin.md) for
how to build a new one.

## system-stats (`@desk-agent/plugin-system-stats`)

CPU %, RAM %, battery %, and system-wide Now Playing with media transport
controls. Polls every 2 s.

- **Permissions:** `sys:read-stats`, `sys:control-media`
- **Widget:** `system-stats` — `{ cpuPercent, ramPercent, battery,
  nowPlaying, nowPlayingIsPlaying, nowPlayingArtwork }`
- **How it reads:** CPU from `os.cpus()` deltas in-process; battery via
  `pmset -g batt`; now-playing via `nowplaying-cli get` (macOS's system-wide
  MediaRemote registration — source-agnostic across Music, Spotify, browser
  tabs). It `pgrep`s for a known player first so `nowplaying-cli` can never
  relaunch a quit Music.app, and keeps a paused track visible for a 30 s
  grace window so the resume button doesn't vanish.
- **Actions:** `play`, `pause`, `togglePlayPause`, `next`, `previous`
  (invoked by the phone's Now Playing screen via `action.invoke`).

## weather (`@desk-agent/plugin-weather`)

Current conditions + 7-day forecast from **Open-Meteo** — no API key.

- **Permissions:** `net:api.weather`
- **Widget:** `weather` — `{ tempF, conditions, forecast[], stale }`
- **Config:** the `weather` block of `config.json`
  (`{ location, intervalMs }`) via the `createPlugin(config)` factory form —
  currently the only plugin that receives config.
- **Failure behavior:** geocoding/API failures republish the last-good
  reading with `stale: true` (the phone shows a STALE badge); a bad location
  never crashes the agent.

## energy-saver (`@desk-agent/plugin-energy-saver`)

The action end of the presence loop. Drives no widget.

- **Permissions:** `sys:control-display`
- **Actions:** `sleep-display` → `pmset displaysleepnow`;
  `wake-display` → `caffeinate -u -t 2` (invoked by the core's built-in
  automation rules on `person_present: false` / `presence.returned`).

## Adding a plugin here

1. Create `packages/plugins/<name>/` mirroring an existing plugin's layout.
2. Register it in the registry in `packages/core/src/main.ts`
   (`resolvePluginRegistry`) — id, `require.resolve` module path, declared
   permissions, and a `configKey` if it takes config.
3. Add it to `enabledPlugins` (schema default lives in
   `packages/config-schema`).
4. If it needs a new OS command, add an `EXEC_ALLOWLIST` entry in
   `packages/core/src/permissionEnforcer.ts` **with a test** — that's the
   security boundary.

Test with `createFakeHost` from the plugin-sdk; every plugin here has a
co-located `src/index.test.ts` showing the pattern.
