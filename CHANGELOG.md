# Changelog

All notable changes to Desk Agent OS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/) at the product level (one
version for the whole monorepo, not per-package — see
[CONTRIBUTING.md](CONTRIBUTING.md#versioning--releases)).

## [Unreleased]

### Added

- **macOS menu-bar app** (`apps/mac`): a native Electron shell that runs the
  core agent so you no longer need a terminal. It forks `@desk-agent/core` as
  a supervised `utilityProcess` (crash-restart with the same exponential
  backoff the plugin host uses), shows a tray icon whose color tracks core
  health, and provides a settings window with seven panes (Overview, Plugins,
  Widgets, Presence, Automation, Device, Logs) fed by a typed ControlChannel
  over the UtilityProcess port — the app never touches the phone's WebSocket.
  Includes launch-at-login (macOS login item), an optional launchd
  LaunchAgent that starts the app itself when a phone is docked
  (`adb wait-for-device` → `open -b com.deskagent.mac`), a single-instance
  lock so a second launch can't collide on the gateway port, atomic
  Zod-validated config writes with a debounced core restart on change, and
  unsigned arm64 packaging via electron-builder
  (`pnpm --filter @desk-agent/mac pack`). The Phase 0 de-risking spike that
  proved the core boots inside a packaged Electron `utilityProcess` is kept
  as `apps/spike-electron` for reference only.
- **`@desk-agent/config-schema` package**: the core's Zod config schema
  extracted into a Node-free package so the Electron renderer (a browser
  context with no `fs`) can validate and edit the same schema the core
  boots from. `packages/core/src/configLoader.ts` now re-exports it and
  keeps only the file-reading wrapper.
- **Widget-visibility sync**: a new `visibleWidgets` config field (default:
  all of `WIDGET_IDS`) controls which widget tiles the phone's Home screen
  renders. The Mac app's Widgets pane edits it; the core includes the list
  in the `hello`-reply `widget.update` snapshot; the phone renders tiles
  conditionally. Later `widget.update` pushes omit the field, meaning "no
  visibility change".
- **Auto-launch the phone app on USB dock**: `TunnelSupervisor` now awaits
  `adb reverse` actually completing before running
  `adb shell am start -n com.deskagentapp/.MainActivity` on every
  device-attach event, so the phone app no longer has to be opened by hand
  each time it's docked (closes the backlog item discovered during Slice 1c
  hardware verification, 2026-07-12). `MainActivity` is `singleTask`, so this
  is safe to fire unconditionally — an already-running app is just brought to
  the front. A new `config.launchAppOnDock` field (default `true`) sets the
  boot-time default; a live, session-scoped Device pane toggle ("Launch app
  on phone when docked") can disable it without restarting the core,
  mirroring the automation-engine toggle. A "Launch now" button (Device pane,
  disabled with "Re-issue" when no phone is paired) triggers it manually
  regardless of the toggle, and its result is reflected in the pane
  immediately rather than waiting for the next periodic snapshot. 13 new
  vitest tests across `tunnelSupervisor.test.ts`, `adbRunner.test.ts`, and
  `controlChannel.test.ts`.
- **Phone screensaver on/off + duration toggle**: the ambient idle
  screensaver (previously a fixed 2-minute timer) is now configurable from a
  new phone Settings screen and mirrored in the Mac app's Device pane. The
  phone is the source of truth (persisted in AsyncStorage); the Mac side is
  a read-back mirror. This shipped the first core→phone command channel:
  the core sends an `action.invoke` frame to the sentinel plugin id
  `phone-display` with a Zod-validated `ScreensaverConfigSchema`
  (`{ enabled, graceMs }`) payload, and the phone reports the applied config
  back via `event.publish`.

### Changed

- **Phone display visual-polish pass**: the dashboard adopted the
  `docs/design-review/mockups` visual language — per-widget accent bars,
  icon chips, status badges, axis-labeled area charts — via new tested
  primitives (`IconChip`, `Badge`, `AreaChart`) and pure helpers
  (`loadColor`, `formatBattery`, `windowStats`), without fabricating any
  data the core didn't actually send. Includes an OLED ghost-bleed fix.
  Verified on-device (OnePlus 6T).

### Fixed

- A JNI reference-table leak crash: `CameraPresence` is now memoized so
  Home-screen re-renders no longer re-mount the camera pipeline.

## [0.3.0] — Slice 1c: wake-from-sleep + Slice 1d: phone display UI — 2026-07-12

Two slices, released together since both landed on `main` before either was
tagged. Roughly 140 new/modified vitest tests across the two, plus this
release's own first Kotlin native-module test coverage (9 tests, JUnit +
MockK + Robolectric) and ~10 new pure-logic `.ts` modules extracted from
previously-untested `.tsx` display components.

### Added — Slice 1c: programmatic wake-from-sleep

- **Wake-on-return** (100% Mac-side; no `app/` or protocol changes): when the
  presence engine sees a genuine, sensor-driven `absent → present` edge, a new
  purely-additive `onGenuineReturn` callback publishes a Mac-internal
  `presence.returned` event, which a zero-debounce automation rule turns into
  `energy-saver.wake-display` (`caffeinate -u -t 2`). The fail-safe
  forced-present path (camera error, watchdog timeout, boot default) can
  never trigger a wake.
- New `presence.wakeEnabled` config field (default `true`) so wake-on-return
  can be disabled independently of auto-sleep.
- 17 new/modified vitest tests, including end-to-end proofs that the wake
  fires on a real return and never on a fail-safe transition.
- **Hardware-verified 2026-07-12** on a OnePlus 6T + target Mac/external HDMI
  monitor — see SETUP.md's wake-on-return checklist. `caffeinate -u -t 2`
  genuinely wakes the monitor from real DPMS sleep, walk-back auto-wake works
  with no keypress, the fail-safe path correctly never wakes the display, and
  `presence.wakeEnabled: false` correctly disables only the programmatic
  wake (auto-sleep unaffected).

### Added — Slice 1d: phone display UI, live camera preview, weather rework, Chin Light

- **Phone-mounted dashboard**: a designed multi-screen UI replacing the
  original unstyled single-screen scaffold — a Home screen with per-widget
  cards, tap-through detail screens (Clock, System, Weather, Presence, Now
  Playing), a nav/screen-state reducer, an ambient idle/asleep clock screen,
  local auto-idle policy, CPU/RAM sparkline history buffers, OLED
  pixel-shift drift mitigation, and IBM Plex Mono font bundling.
- **Live camera preview + face-detection bounding-box overlay** on the
  PRESENCE detail screen: the persistently-mounted camera (never
  interrupted, so detection keeps running on every screen) is portaled into
  a measured on-screen slot with a green accent bounding box tracking the
  detected face. Includes a fix for a Fabric render crash (unifying two
  conditional `<Camera>` render paths that were sending an explicit `null`
  to a non-nullable native prop) and a sensor-orientation correction
  (`orientBBoxForPreview.ts`) for a rotation-plus-reflection bbox
  misalignment found on-device. See
  `docs/superpowers/plans/2026-07-12-presence-live-camera-preview.md` for
  the full implementation trail.
- **Weather widget migrated to Open-Meteo** with a 7-day forecast detail
  screen and an F/C toggle.
- **New Chin Light widget**: a Home-screen card that turns the phone's own
  screen into a fullscreen fill light (White/Sunlight presets, adjustable
  rendered brightness, forced OS screen brightness via a new in-repo
  `Brightness` native module, tap-to-reveal controls, 30-minute auto-exit,
  idle-suppression so the local auto-idle timer never fires mid-call).

### Fixed — system-wide Now Playing + media controls

- `system-stats`'s now-playing read no longer queries Apple Music
  exclusively via `tell application "Music"`, which unconditionally
  launched Music.app if it wasn't already running — causing it to
  relentlessly relaunch itself every 2s poll even after being force-quit,
  and reporting "unavailable" for anyone using a different player. Replaced
  with `nowplaying-cli`, which reads macOS's system-wide MediaRemote
  registration (the same source Control Center uses) — source-agnostic
  across Music, Spotify, and browser tabs, and a passive read with no app
  to launch.
- Added album artwork and play/pause/next/previous controls, gated behind a
  new `sys:control-media` permission, with a short local grace window
  distinguishing "paused a moment ago" from "the source app quit hours
  ago" (both report the same null `playbackRate` from `nowplaying-cli`).
- The WebSocket gateway now actually routes incoming `action.invoke` frames
  to plugins — previously a no-op, so the phone had no way to trigger a
  plugin action at all.

### Fixed

- Core no longer dies with an uncaught exception when `adb` is missing from
  `PATH` (`spawn` error now logged; tunnel degrades, everything else runs).
- Missing or malformed `config.json` now fails with an error naming the
  resolved path and the fix, instead of a raw ENOENT/SyntaxError stack.
- The WebSocket gateway attaches its `connection` handler at construction
  (clients connecting during the worker-startup window are served instead of
  silently ignored until heartbeat timeout) and logs server errors such as
  `EADDRINUSE` instead of crashing uncaught.
- Worker-host startup failures are caught, logged, and exit non-zero instead
  of surfacing as an unhandled promise rejection.
- A latent divide-by-zero: dragging the Chin Light brightness slider before
  its track's first `onLayout` measurement (width 0) propagated `NaN` into
  brightness, desyncing the slider fill/knob from the actual value. Fixed
  by extracting the drag math into a guarded, unit-tested
  `lightScreenDrag.ts` helper.

### Security

- `exec.run` is now gated by a per-permission command allowlist instead of
  "holds any `sys:*` permission": `sys:read-stats` unlocks only `pmset -g …`
  and `osascript`, `sys:control-display` only `pmset displaysleepnow` and
  `caffeinate`, and no permission unlocks arbitrary commands. Previously
  either permission granted unrestricted command execution.

### Changed

- Public documentation overhaul: README, AGENTS.md, SETUP.md, CONTRIBUTING.md,
  this changelog, and a GitHub wiki.
- Backfilled test coverage on two previously-untested surfaces: five
  predicates/formatters extracted out of `.tsx` display components into
  tested `.ts` helpers (`connectionChip`, `triState`, `systemFormat`,
  `nowPlayingFormat`, `lightScreenDrag`), and the two in-repo Android native
  modules (`BrightnessModule`, `PresenceServiceModule`) got their first
  JUnit/MockK/Robolectric unit tests.

## [0.2.0] — Slice 1b: Real camera presence — 2026-07-11

Replaces the stubbed presence toggle from Slice 1a with genuine on-device
camera presence detection, feeding the same automation → energy-saver path so
the Mac display auto-sleeps only when the user is truly away.

### Added
- **Phone-side CV pipeline** (`app/src/presence/`): a VisionCamera 5 /
  Nitro-Modules frame processor running on-device MLKit face detection at
  2–3 fps, deriving `faceVisible` / `gazeAtScreen` / `motionActive` booleans
  (`signalDeriver.ts`) and emitting them as debounced, transition-only edge
  events (`edgeEmitter.ts`) — frames never leave the phone.
- **Mac-side presence engine** (`packages/core/src/presenceEngine.ts`): a
  `present → maybe-absent → absent` hysteresis state machine that fuses the
  four honest sensor signals into the single `person_present` event the
  existing `AutomationEngine` already consumed in Slice 1a. Camera or link
  failure (`camera_state: error|released`, a watchdog-detected silent link
  death, or a missing boot confirmation after a Mac restart) always fails
  toward `present` — the engine can never drive a sleep while it can't
  actually see the desk.
- **Watchdog/heartbeat liveness**: the phone now ACKs the Mac's periodic
  `heartbeat` frame, giving the 30s watchdog a genuine liveness signal
  independent of sensor activity, so a real quiet-but-present desk session
  doesn't spuriously re-trigger fail-to-present every 30 seconds.
- **Honest wire protocol**: four new `sensor.*` edge-event payloads
  (`sensor.face_visible`, `sensor.gaze_at_screen`, `sensor.motion`,
  `sensor.camera_state`) in `packages/protocol/src/schema.ts`, replacing the
  dishonest phone-emitted `person_present`. `person_present` now exists only
  as the Mac-internal event the presence engine derives.
- **Camera privacy controls**: `CameraPrivacySwitch.tsx` fully unmounts the
  camera component (real capture-session teardown, OS indicator off) rather
  than merely ignoring frames; `CameraIndicator.tsx` gives a persistent,
  non-dismissable in-app indicator that can't desync from the actual camera
  state.
- **Android foreground service**: a `camera`-typed foreground service
  (`PresenceForegroundService`), notification channel, and
  `FLAG_KEEP_SCREEN_ON` wiring — built from scratch this slice to survive
  OxygenOS's aggressive background-kill behavior.
- 65 new vitest tests covering the presence engine's hysteresis/fail-to-present
  logic, signal derivation, edge emission, and a synthetic
  sensor-event → `person_present` → auto-sleep integration path.

### Changed
- `packages/core/src/main.ts` now wires `Watchdog.onMissed` to
  `presenceEngine.onCameraState('error', 'watchdog-timeout')`, and clears it
  on the next received heartbeat/`camera_state` — link death and camera
  failure now share one fail-to-present path.
- `presenceEvents.ts` / `App.tsx`: the stubbed `PresenceToggle` is replaced by
  `CameraPrivacySwitch` + `CameraPresence` + `CameraIndicator`.

## [0.1.0] — Slice 1a: Live dashboard + stubbed presence — 2026-07-10

The first buildable slice — the full spine proven end-to-end, with presence
detection stubbed (a fake toggle) so the automation path could be built and
tested with zero camera/CV risk.

### Added
- **Core agent** (`packages/core`): WebSocket gateway, typed event bus,
  `worker_threads`-isolated plugin host with a capability-object permission
  contract, an automation engine, and a Mac-side tunnel supervisor that
  re-issues `adb reverse tcp:8787 tcp:8787` on every phone USB attach.
- **Protocol package** (`packages/protocol`): a versioned, Zod-validated
  message schema (`{v, type, id, ts, payload}`) shared by both the Node core
  and the React Native app.
- **Plugins**: System Stats (CPU/RAM/battery/now-playing), Weather
  (interval-polled, stale-on-failure), Energy Saver (subscribes to
  `person_present`, debounces, calls `pmset displaysleepnow`).
- **React Native dashboard app** (`app/`): renders System Stats and Weather
  widgets live over the WebSocket connection; a stubbed presence toggle
  publishes `person_present` to prove the phone→desktop→action direction.
- **macOS TCC handling**: documented onboarding for the Automation (Apple
  Events) permission `system-stats`'s now-playing read requires.
- **Android reliability groundwork**: `FLAG_KEEP_SCREEN_ON`, a foreground
  service scoped to non-camera use, and documented manual battery/OEM
  autostart steps.
- 87 vitest tests across unit, plugin-contract, and integration suites
  (startup → snapshot → widget-update → event → action, plus simulated
  crash-and-restart and tunnel-down/reconnect).

[Unreleased]: https://github.com/prakharsingh/desk-agent/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/prakharsingh/desk-agent/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/prakharsingh/desk-agent/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/prakharsingh/desk-agent/releases/tag/v0.1.0
