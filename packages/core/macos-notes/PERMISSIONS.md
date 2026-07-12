# macOS Permissions & TCC (Slice 1a)

`system-stats`'s now-playing read shells out to
[`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli)
(`brew install nowplaying-cli`), which reads macOS's system-wide MediaRemote
"Now Playing" registration — the same source Control Center's Now Playing
widget uses. This is source-agnostic (Music, Spotify, and browser tabs
playing HTML5 media all register with it) and, unlike the earlier
per-app-AppleScript approach this replaced, it does **not** trigger a
macOS Automation (Apple Events) TCC prompt.

**It is not a fully passive read, though**: on this macOS version, calling
`nowplaying-cli get` (via `execFile`, i.e. a detached/non-interactive
process — the same call typed into an interactive shell does not reproduce
this) when nothing is currently registered as now-playing has been observed
to relaunch the last-used native player (Music.app) as a side effect. To
avoid this, `readNowPlaying` checks (`pgrep`) whether a known player or
browser process is running first, and skips the `nowplaying-cli` call
entirely when none are — see the comment on `isKnownPlayerRunning` in
`packages/plugins/system-stats/src/index.ts`.

## Runtime dependency

`nowplaying-cli` must be installed (`brew install nowplaying-cli`) on any
machine running the core agent. If it's missing, `system-stats` degrades to
`nowPlaying: 'unavailable'` (same honest-placeholder behavior as any other
exec failure) rather than crashing.

## Packaging note (beyond Slice 1a)

`nowplaying-cli` wraps Apple's private, undocumented `MediaRemote` framework.
If this is ever packaged as a signed/sandboxed `.app`, verify the wrapped
framework calls still resolve under App Sandbox entitlements — private
framework access can be restricted differently than an unsandboxed CLI
process gets.
