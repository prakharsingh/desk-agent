# Troubleshooting

## Tunnel / connectivity

**App shows disconnected / can't reach `ws://localhost:8787`**
- Confirm the core agent is actually running (`node packages/core/dist/main.js`)
  and check its log for `tunnel` messages — the tunnel supervisor should log
  that it issued `adb reverse tcp:8787 tcp:8787` on device attach.
- Replug the USB cable. The tunnel does **not** survive a replug or an `adb`
  server restart on its own; the supervisor re-issues the reverse
  automatically on the next detected device attach, but if it hasn't fired
  yet, a fresh `adb devices` (which restarts the `adb` server if needed)
  followed by a replug should trigger it.
- If you're on the LAN Wi-Fi fallback instead of USB: this repo's auth model
  assumes the USB tunnel *is* the trust boundary. On Wi-Fi, anyone on the same
  network can open a WebSocket to port `8787`. Don't leave this running over
  Wi-Fi beyond occasional testing without adding your own binding/token layer.

**App reconnects but widgets are stale/wrong**
- The client is stateless by design — every reconnect should trigger a full
  snapshot re-sync via `hello`. If you're seeing stale data survive a
  reconnect, that's a bug, not expected behavior; check `wsClient.ts`'s
  reconnect handling.

## Presence detection

**Display sleeps even though I'm at my desk**
- First check the false-absent scenario isn't just "you were unusually
  still" — the hysteresis window (`absenceTimeoutMs`, default 5 min) plus
  `presenceDebounceMs` should tolerate normal stillness while reading, but a
  genuinely motionless, face-away-from-camera posture for the *entire*
  window will legitimately trigger it.
- Check whether the camera was actually healthy the whole time — a
  `camera_state: error` or a watchdog-detected silent link death should force
  `present`, never `absent`. If the display slept anyway, that's a
  fail-to-present regression — see `presenceEngine.ts`'s tests for the
  expected behavior and file an issue.
- Check the in-app camera indicator and the OS green-dot were actually on —
  if the privacy switch was off, the engine has no signal at all and should
  never have been able to sleep the display (this would also be a bug worth
  reporting, not expected behavior).

**Display never sleeps even when I leave**
- Confirm "Automation Enabled" wasn't toggled off — manual override always
  wins by design.
- Confirm the camera indicator/green-dot is actually on — if the camera
  session isn't active, the engine has no way to detect absence.
- Check the core agent's log for repeated `watchdog-timeout` or
  `no-boot-confirmation` fail-to-present triggers — if the phone's heartbeat
  ACKs aren't reaching the Mac (see the tunnel section above), the watchdog
  will keep forcing `present` even during a real absence.

## Phone as an extended display

**"Not supported on this Mac"**
- The private `CGVirtualDisplay` API refused to start on this macOS
  (reason `unsupported`).

**"Display ended" straight away**
- The display runs only in the menu-bar app. A standalone terminal core has no
  helper to spawn, answers `unsupported-host`, and the phone shows the generic
  "Display ended".

**The phone says "Allow Screen Recording for Desk Agent on your Mac"**
- Allow Desk Agent in System Settings › Privacy & Security › Screen & System
  Audio Recording, then tap Try again. If you run the app from a terminal
  (`pnpm --filter @desk-agent/mac dev`), the grant belongs to the terminal.

**The picture works but touch doesn't ("Touch is off" banner)**
- Allow Desk Agent under Privacy & Security › Accessibility. On macOS 27 that
  pane is called **Device Control and Data Access**. The helper re-checks every
  2 seconds, so touch should start on its own; if not, exit and reopen the
  display. After a signing-identity change, remove the stale Desk Agent entry
  and add it again.

**"macOS has Desk Agent Phone switched off on the Mac"**
- macOS remembers a display's state by its identity, and a display you once set
  to "Window or App" in Control Center comes back switched off. Press **Try
  again**: Desk Agent falls back to a spare identity, then a fresh one. If it
  still fails repeatedly, quit and reopen Desk Agent on the Mac, then try again.
- To reset the remembered identities, quit Desk Agent and delete
  `~/.desk-agent/display-identity.json`. It only records which identity
  generation to try per phone; a missing or unreadable file means generation 0,
  and Desk Agent recreates it. Your display arrangement is macOS's, not this
  file's.

**The phone display mirrors my Mac instead of extending it**
- That's a remembered "Entire Screen" choice for the display's identity. Desk
  Agent detects it and falls back to another identity the same way; it never
  changes your display settings itself.

**I can't find how to move a window to the phone**
- Drag it off the screen edge where the phone sits in System Settings ›
  Displays. The phone names the edge for a few seconds when the stream starts.

## Android / OEM background-kill

**App gets killed in the background after a while**
- This is expected on aggressive OEM ROMs (OxygenOS in particular) unless
  you've done the manual, non-programmatic setup: disabling battery
  optimization for the app and enabling OEM autostart/protected-app
  allowlisting. See `apps/android/android-notes/RELIABILITY.md` in the main repo —
  these steps genuinely cannot be set from code, and skipping them is the
  #1 cause of "it worked yesterday, now it's dead" reports.
- The Mac-side watchdog can't revive a killed app — it can only detect and
  surface that it died (missed heartbeats). If you see repeated watchdog
  fail-to-present triggers in the core log, that's the watchdog doing its
  job, not a bug in the watchdog itself.

## macOS

**`nowPlaying: 'unavailable'` in the System Stats widget**
- Install `nowplaying-cli` (`brew install nowplaying-cli`) — the now-playing
  read shells out to it (macOS's system-wide MediaRemote registration; no
  TCC/Automation permission involved). Missing binary → this honest degraded
  state, not a crash; the agent keeps running either way.
- If it's installed but still `unavailable`, check whether any known
  player/browser process is actually running — the plugin deliberately skips
  the read otherwise, because a non-interactive `nowplaying-cli get` with
  nothing registered can relaunch Music.app as a side effect. See
  `packages/core/macos-notes/PERMISSIONS.md`.

**Core won't start / `EADDRINUSE` on port 8787**
- You're probably running the menu-bar app and a terminal
  `node packages/core/dist/main.js` at the same time — they both host the
  gateway on `127.0.0.1:8787`. Quit one. (The app protects against a second
  copy of *itself* via a single-instance lock, but it can't stop a manually
  started terminal core.)

## Build issues

**`vitest run` fails on a fresh clone**
- Run `pnpm build` first. Vitest resolves cross-package imports (e.g. the phone app
  importing `@desk-agent/protocol`) against built `dist/` output.

**Native build fails on the VisionCamera / Nitro Modules chain**
- This dependency chain is a three-package version-alignment story
  (`react-native-vision-camera`, `react-native-nitro-modules`, the worklets
  package) — a version mismatch across those three is the most likely cause
  of a native build failure. Check `apps/android/package.json` for the currently
  pinned, known-working combination before bisecting versions yourself.
