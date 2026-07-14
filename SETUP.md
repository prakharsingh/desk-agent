# Setup

From-zero instructions for building, testing, and running Desk Agent OS on
real hardware: a Mac (the core agent) and a docked Android phone (the
dashboard/sensor app).

## Prerequisites

| For | Need |
|---|---|
| Core agent | macOS, Node.js ≥ 20, pnpm 9+ (`corepack enable`, or `npm i -g pnpm`) |
| Now Playing widget (optional) | `brew install nowplaying-cli` — without it the System Stats widget shows `nowPlaying: unavailable`, everything else works |
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
pnpm build       # runs tsc across every workspace package
pnpm test          # full vitest suite, all packages (watch mode: `pnpm vitest`)
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
crash the agent, just leave that widget stale.

Every field has a sane default — see the full annotated schema table in
**[packages/config-schema/README.md](packages/config-schema/README.md)**.
The ones you're most likely to touch: the `presence` block
(`absenceTimeoutMs`, `gazeIsKeepAwake`, `bootConfirmationTimeoutMs`, and
`wakeEnabled` — set `false` to keep auto-sleep while disabling programmatic
wake-on-return, e.g. if `caffeinate -u` proves unreliable on your hardware),
`launchAppOnDock` (auto-launch the phone app on USB attach, default `true`),
and `visibleWidgets` (which widget tiles the phone shows).

`config.json` is gitignored — never commit real API keys.

## 3. Run the core agent

Two ways to run the Mac side — pick one:

**A. The macOS menu-bar app** (recommended for daily use):

```bash
pnpm --filter @desk-agent/mac dev    # development, live reload
pnpm --filter @desk-agent/mac pack   # unsigned arm64 .app → apps/mac/release/
```

The app runs and supervises the core for you (crash-restart included) and
gives you a tray icon plus a settings window (config, plugins, widgets,
presence, automation, device, logs). It also offers launch-at-login and an
optional "start when the phone is docked" LaunchAgent. Don't run the app and
a terminal core simultaneously — they'd fight over port 8787 (the app itself
holds a single-instance lock for exactly this reason). See
**[apps/mac/README.md](apps/mac/README.md)**.

**B. Standalone terminal process:**

```bash
node packages/core/dist/main.js
```

Reads config from `DESK_AGENT_CONFIG_PATH` if set, else `./config.json`. On
first run it spawns one `worker_thread` per plugin in `enabledPlugins`, starts
the WebSocket gateway (`wsPort`, default `8787`), and starts the tunnel
supervisor.

Either way, install `nowplaying-cli` (`brew install nowplaying-cli`) if you
want the Now Playing widget — it reads macOS's system-wide MediaRemote
registration and needs no TCC/Automation permission. Without it the widget
honestly reports `unavailable`. Details and packaging caveats:
**[packages/core/macos-notes/PERMISSIONS.md](packages/core/macos-notes/PERMISSIONS.md)**.

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
  attach (re-issued automatically on every replug — no manual step), then —
  unless you've disabled `launchAppOnDock` — launches the phone app for you.
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
- [ ] With `nowplaying-cli` not installed → System Stats widget shows
      `nowPlaying: unavailable`, agent stays up (no crash).
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

**Wake-on-return (Slice 1c) — verified 2026-07-12** on a OnePlus 6T +
target Mac/external HDMI monitor. All four checks passed; no code changes
were required.
- [x] **The spike:** with the display asleep (real DPMS sleep via the
      auto-sleep path, not the lid), run `caffeinate -u -t 2` by hand on the
      target Mac + external HDMI monitor → confirm the monitor actually wakes.
      If it doesn't, set `presence.wakeEnabled: false` and keep auto-sleep.
- [x] Let the display auto-sleep, then walk back to the desk → display wakes
      within a few seconds of the camera seeing you, no keypress.
- [x] **Fail-safe test:** while absent (display asleep), force-kill the app so
      the watchdog fires → the engine goes fail-to-present but the display
      must NOT wake (forced-present must never trigger a wake; only a genuine
      absent→present edge may).
- [x] Set `presence.wakeEnabled: false`, restart the core, return from a real
      absence → display stays asleep until a keypress (auto-sleep unaffected).

## Troubleshooting

See the [wiki Troubleshooting page](https://github.com/prakharsingh/desk-agent/wiki/Troubleshooting)
for common failure modes (tunnel not re-establishing, camera permission
denial loops, watchdog false-positives).
