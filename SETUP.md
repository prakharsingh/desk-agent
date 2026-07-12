# Setup

From-zero instructions for building, testing, and running Desk Agent OS on
real hardware: a Mac (the core agent) and a docked Android phone (the
dashboard/sensor app).

## Prerequisites

| For | Need |
|---|---|
| Core agent | macOS, Node.js ≥ 20, pnpm 9+ (`corepack enable`, or `npm i -g pnpm`) |
| React Native app | JDK 17 (React Native 0.86's floor), Android SDK + platform tools (`adb` on `PATH`), an Android device with USB debugging enabled |
| Everything | `git` |

The phone side is Android-only — there's no iOS project in this repo (the
target hardware is a docked Android phone acting as a dashboard, not a mobile
client). Building the app does not require Xcode.

## 1. Install and build

```bash
git clone https://github.com/prakharsingh/desk-agent.git
cd desk-agent
pnpm install
pnpm build       # runs tsc across protocol, plugin-sdk, plugins, core
pnpm test          # 175 tests, all packages (watch mode: `pnpm vitest`)
```

If `pnpm test` fails on a fresh clone, run `pnpm build` first — Vitest
resolves cross-package imports (e.g. `app` importing `@desk-agent/protocol`)
against built `dist/` output, not source.

## 2. Configure the core agent

```bash
cp config.example.json config.json
```

Edit `config.json` — set `weather.location` to a real city name so the
Weather widget (backed by Open-Meteo, no API key needed) returns real
current conditions and a 7-day forecast. It degrades to a `stale`
last-known-value state on any API/geocoding failure, so a bad location won't
crash the agent, just leave that widget stale. See
`packages/core/src/configLoader.ts` for the full schema, defaults, and the
`presence` block Slice 1b added (`absenceTimeoutMs`, `gazeIsKeepAwake`,
`bootConfirmationTimeoutMs`) plus Slice 1c's `presence.wakeEnabled`
(default `true`) — set it to `false` to keep auto-sleep while disabling
programmatic wake-on-return, e.g. if `caffeinate -u` proves unreliable on
your hardware.

`config.json` is gitignored — never commit real API keys.

## 3. Run the core agent

```bash
node packages/core/dist/main.js
```

Reads config from `DESK_AGENT_CONFIG_PATH` if set, else `./config.json`. On
first run it spawns one `worker_thread` per plugin in `enabledPlugins`, starts
the WebSocket gateway (`wsPort`, default `8787`), and starts the tunnel
supervisor.

**Before running unattended** (e.g. via `launchd`): the `system-stats`
plugin's now-playing read triggers a macOS Automation (Apple Events) TCC
prompt the first time it runs, and that prompt can only be answered from a
real UI session. See **[packages/core/macos-notes/PERMISSIONS.md](packages/core/macos-notes/PERMISSIONS.md)**
and do the one-time onboarding there before configuring headless startup.

## 4. Build and run the phone app

The camera pipeline (`react-native-vision-camera` v5 + Nitro Modules + an
MLKit face-detection frame processor) is a native build — there's no
Metro-only JS path for testing presence detection; you need it on a device.

```bash
cd app
pnpm install          # if not already covered by the root install
pnpm android           # react-native run-android — builds & installs the debug APK
```

Grant the Camera permission when prompted. Once running:

- Dock the phone via USB with the core agent already running; the tunnel
  supervisor issues `adb reverse tcp:8787 tcp:8787` automatically on device
  attach (re-issued automatically on every replug — no manual step).
- The app connects to `ws://localhost:8787` through that reverse tunnel.

**Before trusting this on OxygenOS (or any aggressive-background-kill OEM
ROM) long-term**, do the manual, non-programmatic setup steps in
**[app/android-notes/RELIABILITY.md](app/android-notes/RELIABILITY.md)**:
disabling battery optimization for the app and enabling OEM
autostart/protected-app allowlisting. Neither can be set from code; skipping
them means the OS can silently kill the app and you'll only find out via the
Mac-side watchdog.

## Manual E2E checklist

Run this after `pnpm test` is green and both processes are built. It covers
what the automated suite structurally can't: real camera hardware, real OS
background-kill behavior, and real thermal/timing behavior.

**Core spine (from Slice 1a):**
- [ ] Dock phone → tunnel supervisor log shows `adb reverse` issued.
- [ ] Launch app → `hello` → both System Stats and Weather widgets render
      with live values within 5s.
- [ ] Toggle "Automation Enabled" off, then leave the desk — confirm the
      display does NOT sleep (manual override wins).
- [ ] Unplug and replug the USB cable → tunnel supervisor re-issues
      `adb reverse` → app reconnects and re-syncs a fresh snapshot, without
      restarting either process.
- [ ] Deny the Automation (Apple Events) TCC prompt for now-playing → System
      Stats widget shows `nowPlaying: unavailable`, agent stays up (no crash).
- [ ] Leave both processes running overnight → next morning, either the phone
      is still sending heartbeats, or the Mac-side watchdog log shows it
      flagged the silence.

**Presence detection (Slice 1b):**
- [ ] Grant camera permission; confirm the in-app indicator shows and the OS
      green camera-use dot is on.
- [ ] Leave the desk → after the hysteresis window (`absenceTimeoutMs`, plus
      `presenceDebounceMs`) the Mac display sleeps via `pmset`. Return and
      press a key → wakes (physical wake works regardless of Slice 1c).
- [ ] **False-absent test:** sit and read at the desk for 5 minutes → display
      must NOT sleep, even with minimal motion.
- [ ] Flip the camera privacy switch OFF → camera releases (green dot off);
      display never auto-sleeps while the camera is off.
- [ ] **Silent-death test:** with the camera actively confirming presence,
      force-kill the app (or pull the phone off Wi-Fi/USB) without it
      emitting a `camera_state` event. Confirm the Mac-side watchdog fires
      within `WATCHDOG_TIMEOUT_MS`, the engine goes fail-to-present, and the
      display does NOT sleep purely from the resulting silence.

**Wake-on-return (Slice 1c) — REQUIRED before calling 1c done.** Slice 1c is
code-complete but every automated test mocks the shell-exec boundary; nothing
has physically observed a real wake yet. This checklist *is* the missing
hardware spike:
- [ ] **The spike:** with the display asleep (real DPMS sleep via the
      auto-sleep path, not the lid), run `caffeinate -u -t 2` by hand on the
      target Mac + external HDMI monitor → confirm the monitor actually wakes.
      If it doesn't, set `presence.wakeEnabled: false` and keep auto-sleep.
- [ ] Let the display auto-sleep, then walk back to the desk → display wakes
      within a few seconds of the camera seeing you, no keypress.
- [ ] **Fail-safe test:** while absent (display asleep), force-kill the app so
      the watchdog fires → the engine goes fail-to-present but the display
      must NOT wake (forced-present must never trigger a wake; only a genuine
      absent→present edge may).
- [ ] Set `presence.wakeEnabled: false`, restart the core, return from a real
      absence → display stays asleep until a keypress (auto-sleep unaffected).

## Troubleshooting

See the [wiki Troubleshooting page](https://github.com/prakharsingh/desk-agent/wiki/Troubleshooting)
for common failure modes (tunnel not re-establishing, camera permission
denial loops, watchdog false-positives).
