# Roadmap

Desk Agent OS is built and shipped in **slices** — small, end-to-end,
independently useful increments — rather than by architectural layer. Each
slice is a minor semver release; see
[CHANGELOG.md](https://github.com/prakharsingh/desk-agent/blob/main/CHANGELOG.md)
for exactly what shipped in each.

## Shipped

### Slice 1a — v0.1.0 — the spine
The full phone↔Mac spine proven end-to-end with **zero camera/CV**: a live
dashboard (System Stats, Weather widgets) driven desktop→phone, and a
*stubbed* presence toggle proving the phone→desktop→action direction
(`pmset displaysleepnow`). Deliberately fake presence detection, to prove the
architecture without taking on camera risk in the same slice.

### Slice 1b — v0.2.0 — real presence
Replaces the stub with genuine on-device camera presence detection: MLKit
face/motion signals, an honest edge-triggered wire protocol, and a
hysteresis-guarded fusion engine on the Mac. See
[Architecture](Architecture) for the design and
[Hardware](Hardware) for what it's been validated against.

### Slice 1c — v0.3.0 — wake-from-sleep
Programmatic wake of the Mac's external HDMI monitor when presence returns,
without a physical keypress. Deliberately deferred out of 1b — it was the
riskiest, least-certain piece (waking an external monitor out of DPMS via
`caffeinate -u -t 2`, behavior that can vary by monitor/cable) and
independent of presence detection, so isolating it kept it from blocking
1b. Hardware-verified on a OnePlus 6T + target Mac/external HDMI monitor
2026-07-12 — the wake genuinely fires, and the fail-safe path (a
watchdog-triggered forced-present) correctly never wakes the display.

### Slice 1d — v0.3.0 — phone display UI
A designed multi-screen phone dashboard (Home cards, tap-through detail
screens, ambient idle clock) replacing the original unstyled scaffold, plus
a live camera preview with a face-detection bounding-box overlay on the
Presence screen, a weather rework (Open-Meteo, 7-day forecast), and a new
Chin Light widget (fullscreen fill light for video calls). Shipped in the
same v0.3.0 release as Slice 1c since both landed on `main` before either
was tagged — see [CHANGELOG.md](https://github.com/prakharsingh/desk-agent/blob/main/CHANGELOG.md)
for the full breakdown.

## Planned

Nothing currently scoped into a named slice — see "Later" below for the
backlog.

### Later (not yet sliced)
From the original four-version vision (dashboard → voice/presence/AI →
local LLMs/multi-device → marketplace):
- AI Router / local LLM integration (the seam is stubbed, not built)
- Voice / Whisper input
- More plugins (GitHub, Spotify, Calendar, Docker)
- Web dashboard
- Multi-device support
- A real plugin marketplace — which requires actual sandboxing beyond
  `worker_threads`, since a plugin can `require()` `child_process`/`net`
  directly and bypass the capability object today. Not safe for untrusted
  third-party plugin code until that's addressed.

## Design philosophy

Each slice is scoped to prove or ship one thing end-to-end, with explicit,
named spikes for the risky unknowns rather than silently absorbing risk into
a bigger task. Slice 1b's own history is an example: a reality-check audit
against the actual repo (not just the design doc) found that assumed
groundwork — a foreground service, a keep-awake flag — hadn't actually been
built in 1a despite being described as "intended follow-up," and the spec was
corrected before implementation started rather than discovered mid-slice.
