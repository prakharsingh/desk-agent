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

## Phone extended display: Screen Recording and Accessibility

The phone-as-display feature (`apps/mac/native/display-helper`) needs two
grants, both for **Desk Agent** (the app is the responsible process, so the
helper inherits its grants; from `pnpm --filter @desk-agent/mac dev` they
belong to the terminal instead):

| Permission | Pane | Used for | Without it |
|---|---|---|---|
| Screen Recording | Privacy & Security › Screen & System Audio Recording | ScreenCaptureKit capture of the virtual display | the session fails with `permission-screen-recording`; the phone says to allow it |
| Accessibility (`PostEvent`) | Privacy & Security › Accessibility | `CGEvent` mouse injection (touch) | the picture works, touch doesn't; the phone shows a "Touch is off" banner |

- The helper re-checks Accessibility every 2 s while a phone is connected, so a
  grant turns touch on mid-session and a revoke turns it off.
- On the first session of each app launch with Accessibility missing, the app
  asks for it through `desk-agent-display-helper --request-permissions` and,
  3 s later and only if it is still missing, shows a notice with an Open
  Settings button. `desk-agent-display-helper --check` prints both states.
- On **macOS 27** the Accessibility pane is renamed **Device Control and Data
  Access** (System Settings › Privacy & Security › Device Control and Data
  Access). `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`
  still opens it.
- Grants are stored against the app's designated requirement. An ad-hoc build
  has a new one on every rebuild, so it loses them; the self-signed identity in
  [packaging/MAC_SIGNING.md](../../../packaging/MAC_SIGNING.md) keeps them across
  updates. After a deliberate signing-identity rotation, remove the stale Desk
  Agent entry from both panes and add it again.
