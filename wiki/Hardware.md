# Hardware

Camera behavior, thermal load, battery/OEM background-kill behavior, and
display-wake behavior are all device- and OS-version-specific. This project
is designed and validated against specific, recorded hardware rather than
"Android" and "a Mac" in the abstract — a lesson learned the hard way during
Slice 1a, whose spec deliberately left these as open items to be filled in
before Slice 1b started.

## Reference hardware

**Phone:** OnePlus 6T
- Android 11, OxygenOS 11, API 30
- Snapdragon 845, front camera
- Docked and continuously powered — power draw is not a constraint;
  sustained thermal load and throttling is.
- OxygenOS is historically aggressive about killing background work, which
  is why Slice 1b had to build a `camera`-typed foreground service, a
  notification channel, and `FLAG_KEEP_SCREEN_ON` wiring from scratch — none
  of that existed after Slice 1a despite being described there as intended
  follow-up.

**Mac:** Mac mini M5
- Single external HDMI monitor
- macOS ~26
- The Mac never touches a camera — all camera work happens phone-side.
- Physical display wake (keypress) already works without any special
  handling; programmatic wake of the external HDMI monitor is Slice 1c and
  is expected to be more uncertain than an internal laptop panel, since
  external-display wake-from-DPMS behavior can vary by monitor and cable.

## Porting to different hardware

Nothing in the architecture is hard-coded to this exact phone/Mac pair, but
if you're running this on different hardware, budget time for:

- **Thermal tuning** — the default camera fps and MLKit inference cadence
  were tuned against the SD845's specific throttling ceiling
  (`dumpsys thermalservice`-measured over a 2–4 hour soak). A different SoC
  may tolerate a higher fps, or need a lower one.
- **OEM background-kill behavior** — battery-optimization exemption and
  autostart/protected-app allowlisting are manual, OEM-specific steps (see
  [SETUP.md](https://github.com/prakharsingh/desk-agent/blob/main/SETUP.md)
  and `app/android-notes/RELIABILITY.md`) that vary across Xiaomi, Samsung,
  Huawei, Oppo, and others. There's no way to set these programmatically.
- **MLKit accuracy/threshold tuning** — the gaze-at-screen yaw/pitch
  thresholds in `signalDeriver.ts` were tightened based on MLKit's documented
  eye-open-probability reliability envelope for near-frontal faces; a
  different camera's field of view or mounting angle may need different
  thresholds.
- **External-display wake behavior** (Slice 1c) — explicitly
  monitor/cable-dependent, not something to assume transfers from one HDMI
  setup to another. Verified on the reference Mac + external HDMI monitor
  (2026-07-12); SETUP.md's checklist includes a by-hand `caffeinate -u -t 2`
  spike to run on your own setup first, and `presence.wakeEnabled: false`
  keeps auto-sleep while disabling wake if yours doesn't cooperate.

If you validate this on different hardware, consider opening a PR to extend
this page — hardware compatibility notes are exactly the kind of thing this
wiki exists for, per [CONTRIBUTING.md](https://github.com/prakharsingh/desk-agent/blob/main/CONTRIBUTING.md).
