# AGENTS.md

Guide for AI coding agents (and humans) working in this repository. See also
[SETUP.md](SETUP.md) for environment setup and [CONTRIBUTING.md](CONTRIBUTING.md)
for workflow/PR conventions.

## What this is

A TypeScript pnpm monorepo split across two runtimes: a Node.js "core" agent
that runs on a Mac, and a React Native app that runs on a docked Android
phone, connected over a WebSocket tunneled through `adb reverse`. The Mac core
drives what the phone displays; the phone reports honest sensor signals back;
a Mac-side state machine turns those signals into actions (currently: sleeping
the display when the user is truly away).

Read `README.md` for the product pitch and current roadmap slice.

## Architecture map

```
packages/
  protocol/      Shared Zod message schema + types. Single source of truth
                  for the wire format — imported by both core and app.
  plugin-sdk/     Plugin interface, capability-object (`ctx`) types, a fake
                  host test harness for plugin-contract tests.
  core/           The Mac-side agent (Node, main thread):
                    wsGateway.ts        WebSocket server, frame validation
                    eventBus.ts         typed pub/sub between subsystems
                    workerHost.ts       spawns/supervises plugin worker_threads
                    automationEngine.ts rule evaluation (person_present → action)
                    presenceEngine.ts   hysteresis fusion of sensor.* → person_present
                    watchdog.ts         detects missed phone heartbeats
                    tunnelSupervisor.ts re-issues `adb reverse` on device attach
                    configLoader.ts     Zod-validated config schema
                    entrypoint.ts       wires everything together (boot())
                    main.ts             real-clock, real-I/O process entry
  plugins/
    system-stats/  CPU/RAM/battery/now-playing widget (sys:read-stats)
    weather/       polled weather widget (net:api.weather)
    energy-saver/  subscribes to person_present, calls `pmset displaysleepnow`
                   (sys:control-display)
app/
  src/
    App.tsx              top-level RN component, WS client wiring
    wsClient.ts           WebSocket client, heartbeat ACK, reconnect/backoff
    presenceEvents.ts     builders for sensor.* wire frames
    presence/
      CameraPresence.tsx   hosts <Camera>, lifecycle, camera_state emission
      signalDeriver.ts     per-frame MLKit observations → raw booleans (pure)
      edgeEmitter.ts       debounced transition-only event emission (pure)
      frameProcessor.ts    VisionCamera worklet calling the MLKit plugin
      useCameraLifecycle.ts permission/device lifecycle
      CameraIndicator.tsx  persistent "camera active" indicator
    CameraPrivacySwitch.tsx  on/off toggle that unmounts the camera entirely
    widgets/               dashboard widget renderers
  android/                 native Android project (foreground service, manifest)
```

## Data flow (the one loop everything hangs off)

```
phone camera --MLKit-->  signalDeriver (pure)  -->  edgeEmitter (pure, debounced)
  --sensor.* WS frame-->  [Mac] wsGateway --> EventBus
    --> PresenceEngine (hysteresis fusion) --> person_present event
      --> AutomationEngine (debounce) --> energy-saver plugin --> pmset displaysleepnow
```

Widget data flows the opposite direction: a plugin worker publishes
`widget.update` → host validates its declared permission → event bus → WS
broadcast → the app patches one widget.

## Build, test, typecheck

```bash
pnpm install         # install all workspace deps
pnpm build            # runs tsc across every package (protocol/plugin-sdk/plugins/core)
pnpm test              # full test suite, all packages, single run
pnpm vitest             # watch mode
```

Run `pnpm build` before `pnpm test` if you've touched a package another
package imports (e.g. `protocol`) — Vitest resolves workspace packages by
their built output, not on-the-fly.

There's no CI pipeline yet — `pnpm build && pnpm test` passing locally is
the bar for a change to be considered done.

## Conventions that are load-bearing (don't casually violate)

- **TDD.** Every package here was built test-first; `presenceEngine.ts` in
  particular has 20 tests covering hysteresis edge cases specifically because
  the failure mode (a false auto-sleep while someone is quietly reading at
  their desk) is expensive to get wrong and hard to notice.
- **Timers use `vi.useFakeTimers()` against real globals, not injected
  clocks.** `automationEngine.ts`, `watchdog.ts`, and `presenceEngine.ts` all
  call `setTimeout`/`clearTimeout`/`Date.now()` directly and are tested by
  mocking those globals with Vitest's fake timers — this is a deliberate,
  consistent idiom across `packages/core`. Don't introduce a
  constructor-injected clock in one file and not the others.
- **The protocol package is the single source of truth for the wire format.**
  Never hand-copy a payload shape or event-name union elsewhere — import the
  type from `@desk-agent/protocol` (e.g. `CameraStatePayload['state']`
  instead of re-declaring `'active' | 'released' | 'error'`).
- **Only honest, edge-triggered sensor signals cross the wire.** The phone
  never sends "person is present" — it sends what its camera literally
  observed this transition (`face_visible`, `gaze_at_screen`, `motion`,
  `camera_state`). All fusion, judgment, and hysteresis timing happens
  Mac-side in `presenceEngine.ts`, which is why that file — not anything on
  the phone — is the one to change if presence logic needs to change.
- **Fail toward `present`, never toward `absent`.** Any camera error,
  release, watchdog-detected link death, or missing boot confirmation must
  force the presence engine back to `present` and disarm any pending absence
  timer. A bug that fails the other way silently sleeps the user's display
  while they're sitting right there — treat this as the correctness property
  more important than convenience.
- **Plugins reach the outside world only through the capability object
  (`ctx`) passed to `init()`.** The host enforces each plugin's declared
  `permissions` array on every `ctx` call. For `exec.run` this is a
  per-permission command allowlist (`EXEC_ALLOWLIST` in
  `packages/core/src/permissionEnforcer.ts`): `sys:read-stats` unlocks only
  `pmset -g …` and `osascript`, `sys:control-display` only
  `pmset displaysleepnow` and `caffeinate`, and nothing unlocks arbitrary
  commands. A plugin that needs a new command needs a new allowlist entry
  (and a test), not a broader permission. Don't add a plugin capability that
  bypasses this (e.g. importing `child_process` directly in a plugin).
- **Camera privacy is a real teardown, not a mute.** Toggling the privacy
  switch off must unmount `<CameraPresence>` so the OS actually releases the
  capture session (green-dot off) — never just stop processing frames while
  keeping the session alive.

## Where things live (quick lookup)

| I want to... | Look at |
|---|---|
| Add/change a wire message shape | `packages/protocol/src/schema.ts` |
| Change presence fusion/hysteresis logic | `packages/core/src/presenceEngine.ts` |
| Change an automation rule | `packages/core/src/automationEngine.ts` |
| Add a new plugin | `packages/plugins/<name>/`, register in `configLoader.ts`'s `enabledPlugins` default |
| Change camera signal derivation (gaze/motion thresholds) | `app/src/presence/signalDeriver.ts` |
| Change how/when sensor events are emitted | `app/src/presence/edgeEmitter.ts` |
| Touch Android foreground-service / manifest | `app/android/app/src/main/` |
| Touch macOS permission handling | `packages/core/macos-notes/PERMISSIONS.md` |
| Touch Android keep-awake/battery/OEM setup | `app/android-notes/RELIABILITY.md` |

## What not to touch without a strong reason

- `PROTOCOL_VERSION` in `schema.ts` — bumping it breaks every existing frame
  validated with `z.literal(PROTOCOL_VERSION)`; only bump on an actual
  breaking wire-format change, not an additive one.
- The `automationEngine.ts` → `energy-saver` path — it's the one piece of
  Slice 1a that every later slice depends on unchanged; new presence sources
  should produce the same `person_present` event, not a parallel path.
