# macOS Permissions & TCC (Slice 1a)

`system-stats`'s now-playing read shells out to
[`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli)
(`brew install nowplaying-cli`), which reads macOS's system-wide MediaRemote
"Now Playing" registration — the same source Control Center's Now Playing
widget uses. This is source-agnostic (Music, Spotify, and browser tabs
playing HTML5 media all register with it) and, unlike the earlier
per-app-AppleScript approach this replaced, it does **not** trigger a
macOS Automation (Apple Events) TCC prompt — it's a passive read with no
app to launch or address by name.

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
