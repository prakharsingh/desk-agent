# Desk Agent OS

**v0.3.0** · 355 vitest tests + 9 JUnit/Robolectric tests passing · [Changelog](CHANGELOG.md)

An old Android phone, docked next to a Mac, becomes a live desk dashboard and
an honest presence sensor. A Mac-side Node "brain" drives what the phone shows
and reacts to what the phone honestly reports seeing — starting with
auto-sleeping the display when you're genuinely away from your desk.

```
[Mac core: gateway, event bus, plugins, automation]  <--WebSocket over USB-->  [phone: RN dashboard + camera CV]
        |                                                                              |
   widget.update  ------------------------------------------------------------->  live widgets render
   sensor.face_visible / sensor.gaze_at_screen / sensor.motion / sensor.camera_state
        |  <-------------------------------------------------------------------  on-device MLKit face detection
   PresenceEngine (hysteresis fusion, Mac-side)
        |
   person_present  -->  AutomationEngine  -->  energy-saver plugin  -->  pmset displaysleepnow
```

**Honest signals, not vibes.** The phone never claims "person present" — it
only reports what its camera actually saw this frame (`face_visible`,
`gaze_at_screen`, `motion`) as debounced edge events, and never leaves the
device. All the judgment — fusing those signals, applying a multi-minute
hysteresis window so a still moment reading doesn't sleep your display, and
failing safe toward "present" the instant the camera or link looks unhealthy
— lives in a fully unit-tested state machine on the Mac
(`packages/core/src/presenceEngine.ts`).

## Roadmap

| Slice | Status | Delivers |
|---|---|---|
| **1a** | ✅ shipped | Live dashboard (System Stats, Weather) + stubbed presence toggle proving the phone↔Mac spine |
| **1b** | ✅ shipped | Real camera presence detection, hysteresis-guarded auto-sleep, honest `sensor.*` protocol |
| **1c** | ✅ shipped | Programmatic wake of the external HDMI monitor when presence returns (no physical keypress), `caffeinate -u -t 2`. Hardware-verified on a OnePlus 6T + target Mac/monitor. `presence.wakeEnabled: false` disables it independently of auto-sleep. |
| **1d** | ✅ shipped | Designed multi-screen phone dashboard, live camera preview + face-box overlay on the Presence screen, Open-Meteo weather rework, and the Chin Light fullscreen fill-light widget |

See [CHANGELOG.md](CHANGELOG.md) for what shipped in each slice.

## Quickstart

```bash
pnpm install
pnpm build
pnpm test
```

That builds and tests the whole monorepo. For running the actual agent + app
on real hardware (Node core on the Mac, React Native app on a docked Android
phone) and the full manual verification checklist, see **[SETUP.md](SETUP.md)**.

## Documentation

- **[SETUP.md](SETUP.md)** — from-zero install, running the core + app on
  real hardware, manual E2E checklist.
- **[AGENTS.md](AGENTS.md)** — architecture map and conventions for anyone
  (human or AI coding agent) working in this codebase.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — branch/commit conventions, test
  expectations, PR process, versioning & release model.
- **[CHANGELOG.md](CHANGELOG.md)** — what shipped in each release.
- **[Wiki](https://github.com/prakharsingh/desk-agent/wiki)** — deeper
  architecture notes, hardware specifics, and troubleshooting.

## License

[MIT](LICENSE)
