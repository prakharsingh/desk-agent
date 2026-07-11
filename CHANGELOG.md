# Changelog

All notable changes to Desk Agent OS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/) at the product level (one
version for the whole monorepo, not per-package — see
[CONTRIBUTING.md](CONTRIBUTING.md#versioning--releases)).

## [Unreleased]

- Public documentation overhaul: README, AGENTS.md, SETUP.md, CONTRIBUTING.md,
  this changelog, and a GitHub wiki.

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

[Unreleased]: https://github.com/prakharsingh/desk-agent/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/prakharsingh/desk-agent/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/prakharsingh/desk-agent/releases/tag/v0.1.0
