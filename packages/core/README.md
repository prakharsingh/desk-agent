# @desk-agent/core

The Mac-side "brain": a Node process that hosts plugins, talks to the docked
phone over WebSocket, fuses the phone's honest sensor signals into a
presence decision, and drives automations (auto-sleep / auto-wake of the
display). It runs standalone (`node packages/core/dist/main.js`) or embedded
inside the macOS app (`apps/mac`) as a supervised Electron `utilityProcess`.

## Module map

| File | Responsibility |
|---|---|
| `main.ts` | Process entry — `run(opts)`: loads config, builds everything, boots. Also defines the built-in plugin registry (`system-stats`, `weather`, `energy-saver`). |
| `entrypoint.ts` | `boot(deps)`: wires EventBus subscriptions (sensor events → PresenceEngine, `person_present`/`presence.returned` → AutomationEngine, overrides, screensaver config) and starts tunnel, gateway, watchdog. Also `buildPluginSpecs` and the two built-in automation rules. |
| `wsGateway.ts` | WebSocket server on `127.0.0.1:<wsPort>` (default 8787). Validates every frame against `@desk-agent/protocol`, answers `hello` with a full widget snapshot (+ `visibleWidgets`), broadcasts `heartbeat` every 5 s, routes `event.publish` / `action.invoke`, pushes single-widget updates and the screensaver-config command. |
| `eventBus.ts` | Typed in-memory pub/sub; validates publishes, supports `'*'`. |
| `workerHost.ts` / `workerEntry.ts` | One `worker_thread` per plugin (128 MB heap cap, 3 s call deadline, exponential-backoff restart, `failed` after 5 crashes). The worker side builds the real `Ctx` and wraps it in the permission enforcer. |
| `permissionEnforcer.ts` | Gates `ctx.http.fetch` and `ctx.exec.run` per declared permission; `EXEC_ALLOWLIST` pins each permission to specific command + first-arg pairs. |
| `presenceEngine.ts` | The `present → maybe-absent → absent` hysteresis state machine. **The one file to change if presence logic needs to change** — and the one with the strictest review bar (see CONTRIBUTING.md). Fails toward `present` on camera error, link death, or missing boot confirmation. |
| `automationEngine.ts` | Debounced rule evaluation (`person_present` → sleep, `presence.returned` → wake), global + per-rule session toggles. |
| `watchdog.ts` | Missed-heartbeat detector; on timeout forces the presence engine into fail-to-present via `onCameraState('error', 'watchdog-timeout')`. |
| `tunnelSupervisor.ts` / `adbRunner.ts` | Re-issues `adb reverse tcp:<port> tcp:<port>` on every phone USB attach; optionally auto-launches the phone app (`adb shell am start`, gated by `launchAppOnDock`). Survives a missing `adb` (tunnel degrades, core stays up). |
| `controlChannel.ts` | Electron-host-only status/command channel over the UtilityProcess port (snapshots every 5 s + on change; commands like `reissueTunnel`, `setAutomationEnabled`, `setScreensaverConfig`). Inert when running standalone. |
| `screensaverConfigStore.ts` | Mirror of the phone-owned screensaver config (phone is source of truth). |
| `configLoader.ts` | File loading + friendly errors; re-exports the schema from `@desk-agent/config-schema`. |

## Running standalone

```bash
pnpm build
node packages/core/dist/main.js
```

Config comes from `DESK_AGENT_CONFIG_PATH` if set, else `./config.json`
(copy `config.example.json`). See the repo-root **[SETUP.md](../../SETUP.md)**
for the full hardware walkthrough, and
**[macos-notes/PERMISSIONS.md](macos-notes/PERMISSIONS.md)** before running
unattended — the now-playing read depends on `nowplaying-cli`
(`brew install nowplaying-cli`; system-stats degrades to
`nowPlaying: 'unavailable'` without it).

## Conventions that are load-bearing here

- **Fail toward `present`, never toward `absent`.** Any camera error,
  watchdog-detected link death, or missing boot confirmation must force the
  presence engine back to `present` and disarm pending absence timers. This
  is the system's most important correctness property.
- **Timers use `vi.useFakeTimers()` against real globals**, not injected
  clocks — `automationEngine`, `watchdog`, and `presenceEngine` all follow
  this idiom; don't introduce a constructor-injected clock in one file only.
- **TDD.** Every module here has a co-located `*.test.ts`;
  `presenceEngine.test.ts` alone has 31 tests because its failure mode (a
  false auto-sleep while someone sits reading) is expensive and silent.

See **[AGENTS.md](../../AGENTS.md)** for the full conventions list and
architecture map.
