# macOS Permissions & TCC (Slice 1a)

`system-stats`'s now-playing read (`osascript ... tell application "Music"`)
triggers a macOS **Automation (Apple Events)** TCC prompt the first time it
runs. This grant is scoped to the *signing identity of the launching binary*
— it does NOT transfer between a dev Terminal running `node` and a packaged
app or `launchd` job. Treat "run once from Terminal" and "run via launchd" as
two separate permission stories.

## Required onboarding step (do this once, before any headless operation)

1. Run the core agent (`node packages/core/dist/main.js`) manually from a
   Terminal with an active UI session logged in.
2. The first now-playing poll triggers the Automation prompt — click **OK**.
   If you miss it or click **Don't Allow**, reset via:
   `tccutil reset AppleEvents` and re-run.
3. Only after this grant exists for the exact binary/identity you'll use
   long-term (Terminal `node`, a packaged app, or a `launchd` plist) should
   you configure it to start automatically without a UI session present.

## Why this matters

If the agent is ever first started via `launchd` before this onboarding has
happened through a real UI session, the Automation prompt cannot be shown,
and the permission silently stays denied. This is NOT a crash — `system-stats`
degrades to `nowPlaying: 'unavailable'` (see Task 13) and the agent keeps
running. But you'll be stuck in that degraded state until you do the manual
onboarding step above through a UI session.

## Packaging note (beyond Slice 1a)

If this is ever packaged as a signed `.app` or run under `launchd`, add
`NSAppleEventsUsageDescription` to its `Info.plist` describing why Apple
Events access is requested (surfaced in the system TCC prompt copy).
