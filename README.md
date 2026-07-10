# Desk Agent OS — Slice 1a

Docked Android phone renders an always-on React Native dashboard (System
Stats + Weather) driven by a Mac-side Node core agent over WebSocket. A
stubbed presence toggle in the app flows phone→desktop→action
(`pmset displaysleepnow`), proving both data-flow directions.

See `docs/superpowers/specs/2026-07-10-desk-agent-os-slice1a-design.md` for
the full design and `docs/superpowers/plans/2026-07-10-desk-agent-os-slice1a.md`
for the implementation plan (both gitignored locally; consult your working
tree, not the remote, if they're missing).

## Setup

```bash
rtk pnpm install
rtk pnpm build
rtk vitest run
```

## Running

1. Start the core agent: `node packages/core/dist/main.js` (reads config from
   `DESK_AGENT_CONFIG_PATH` or `./config.json` — see
   `packages/core/src/configLoader.ts` for the schema).
2. Dock the phone via USB; the tunnel supervisor issues
   `adb reverse tcp:8787 tcp:8787` automatically on device attach.
3. Launch the React Native app on the phone (`app/`); it connects to
   `ws://localhost:8787` (reachable through the reverse tunnel).

## Android manual setup (required once per device)

See `app/android-notes/RELIABILITY.md` — keep-awake, foreground service,
battery optimization, OEM autostart allowlisting.

## macOS manual setup (required once, before any headless/launchd operation)

See `packages/core/macos-notes/PERMISSIONS.md` — the Automation (Apple
Events) TCC prompt for now-playing must be granted through a real UI session
before the agent is ever started unattended.

## Manual E2E checklist (Slice 1a)

Run this after `rtk vitest run` is green and both processes are built:

- [ ] Dock phone → tunnel supervisor log shows `adb reverse` issued.
- [ ] Launch app → `hello` → both System Stats and Weather widgets render
      with live values within 5s.
- [ ] Toggle "Present" off in the app → within `presenceDebounceMs`, the Mac
      display sleeps via `pmset displaysleepnow`.
- [ ] Wake the Mac only via physical touch/keypress — toggling "Present" back
      on does NOT itself wake the display (no programmatic wake in 1a).
- [ ] Toggle "Automation Enabled" off, then toggle "Present" off — confirm the
      display does NOT sleep (manual override wins).
- [ ] Unplug and replug the USB cable → tunnel supervisor re-issues
      `adb reverse` → app reconnects and re-syncs a fresh snapshot, without
      restarting either process.
- [ ] Deny the Automation (Apple Events) TCC prompt for now-playing → System
      Stats widget shows `nowPlaying: unavailable`, agent stays up (no crash).
- [ ] Leave both processes running overnight → next morning, either the phone
      is still sending heartbeats, or the Mac-side watchdog log shows it
      flagged the silence.

## Open Items (record before Slice 1b)

- Exact target phone make + Android/OEM version: _______________
- Exact target Mac model + macOS version: _______________
