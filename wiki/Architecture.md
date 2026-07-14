# Architecture

## Two runtimes, one protocol

Desk Agent OS is a TypeScript pnpm monorepo split across two processes:

1. **The core agent** (`packages/core`, Node.js, runs on the Mac) — the
   "brain." A WebSocket gateway, a typed event bus, a `worker_threads`-based
   plugin host with a capability-object permission model, an automation
   engine, and (since Slice 1b) a presence-fusion state machine.
2. **The phone app** (`app/`, React Native, runs on a docked Android phone) —
   a thin sensor + display. Renders dashboard widgets the core pushes to it,
   and reports honest, on-device-derived signals back.

They talk over a WebSocket, USB-tunneled via `adb reverse tcp:8787 tcp:8787`,
using a versioned, Zod-validated message schema defined once in
`packages/protocol` and imported by both sides — see
[Protocol Reference](Protocol-Reference).

## Why the phone doesn't decide presence

An earlier design had the phone directly publish `person_present: true/false`.
That's dishonest: face-visible ≠ desk-presence, and a threshold picked
phone-side gets no test coverage and no visibility into *why* it fired. Slice
1b's design instead treats the phone as a **thin, honest sensor**:

- The phone runs on-device MLKit face detection over a low-fps VisionCamera
  feed, purely locally — frames never leave the device.
- `signalDeriver.ts` (pure function, phone-side) turns per-frame observations
  into three raw booleans: `faceVisible`, `gazeAtScreen` (a head-attention
  proxy — MLKit has no real gaze vector), and `motionActive`.
- `edgeEmitter.ts` (pure function, phone-side) emits those as **debounced,
  transition-only** WebSocket events — `sensor.face_visible`,
  `sensor.gaze_at_screen`, `sensor.motion`, plus `sensor.camera_state` for
  pipeline health — never a per-frame flood.
- **All judgment lives on the Mac**, in `packages/core/src/presenceEngine.ts`:
  a `present → maybe-absent → absent` hysteresis state machine that fuses the
  four signals, applies a multi-minute absence window (so a still moment
  doesn't sleep the display), and — critically — fails toward `present`
  whenever the camera or link looks unhealthy.

This split matches the existing 1a idiom ("phone = sensor/display, Mac =
brain") and means the stateful, correctness-critical logic gets full
`vitest` coverage with fake timers, the same way `automationEngine.ts` and
`watchdog.ts` already do — instead of living untested in RN code on the
phone.

## The data flow loop

```
phone camera --MLKit-->  signalDeriver (pure)  -->  edgeEmitter (pure, debounced)
  --sensor.* WS frame-->  [Mac] wsGateway --> EventBus
    --> PresenceEngine (hysteresis fusion) --> person_present event
      --> AutomationEngine (debounce) --> energy-saver plugin --> pmset displaysleepnow
```

Widget data flows the opposite direction: a plugin worker calls
`ctx.publish('widget.update', payload)` → the host checks the plugin's
declared permission → the event bus fans it out → a WebSocket broadcast → the
app patches just that one widget. Widgets are declarative (`{type, props}`);
the app renders from a small fixed set of renderers, not plugin-supplied UI
code.

## Failing safe

The single most important correctness property in this system: **the
presence engine must never sleep the display unless it's confident someone is
actually absent.** Concretely, it forces itself back to `present` and
disarms any pending absence timer whenever:

- The phone explicitly reports `camera_state: 'error' | 'released'`.
- The Mac-side `Watchdog` detects a silent link death (missed heartbeats) —
  this covers the case where OxygenOS kills the app or the USB tunnel drops
  *without* the phone getting a chance to say so.
- The engine boots (or the Mac core process restarts) and no keep-awake
  signal or `camera_state: active` arrives within a boot-confirmation window
  — this prevents trusting a stale "present" default indefinitely after a
  restart.

A false auto-sleep while someone is at their desk is a much worse failure
than an occasional missed auto-sleep — the fail-safe direction is
deliberate and asymmetric.

## The macOS app shell

The core runs either standalone (`node packages/core/dist/main.js`) or
inside the menu-bar app (`apps/mac`, Electron). The app forks the core as a
supervised `utilityProcess` (same exponential-backoff restart policy the
plugin host uses on workers) and talks to it over a typed **ControlChannel**
on the UtilityProcess port — status snapshots out, commands (pause
automation, re-issue tunnel, launch phone app, screensaver config) in. Two
deliberate boundaries:

- **The app never touches the phone's WebSocket.** The core owns the gateway
  on `127.0.0.1:8787` in both modes; the app is a supervisor + settings UI,
  not a second protocol peer. A single-instance lock prevents two app copies
  from colliding on the port.
- **Config stays one Zod schema.** `packages/config-schema` is Node-free so
  the Electron renderer can validate the same schema the core boots from;
  the app writes config atomically and restarts the core (debounced),
  because the core reads config only at boot.

## Plugin isolation

Plugins run in their own `worker_thread`, declare `id` + a `permissions`
array (e.g. `sys:read-stats`, `net:api.weather`, `sys:control-display`), and
reach the outside world *only* through a capability object (`ctx`) the host
passes to `init()`. The host enforces declared permissions on every `ctx`
call. This provides fault isolation for JS-level errors/hangs — a worker
crash or a cooperatively-terminable hang is caught and the worker restarted —
but not memory/native-crash isolation (an OOM or native-addon segfault can
still abort the whole process). This is a documented ceiling, not an
oversight; real sandboxing would be required before accepting untrusted
third-party plugin code.

## Repo layout

See [AGENTS.md](https://github.com/prakharsingh/desk-agent/blob/main/AGENTS.md)
in the main repo for the current file-by-file map — it's kept close to the
code on purpose, so check there rather than duplicating it here.
