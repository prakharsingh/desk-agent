# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via
[GitHub's private vulnerability reporting](https://github.com/prakharsingh/desk-agent/security/advisories/new)
rather than a public issue. You should get an acknowledgement within a few
days; this is a small single-maintainer project, so please allow a
reasonable window for a fix before public disclosure.

## Supported versions

Only the latest release (and `main`) receives fixes.

## The threat model, honestly stated

This project runs on your own hardware, on your own desk, and its security
posture is designed around that:

- **The WebSocket gateway binds to `127.0.0.1` only.** The phone reaches it
  through a USB `adb reverse` tunnel. **The USB cable is the trust
  boundary** — there is no authentication or encryption on the WebSocket
  itself. If you expose the port over Wi-Fi/LAN for testing, anyone on the
  network can drive your dashboard and inject sensor events; don't run it
  that way unattended.
- **Camera frames never leave the phone.** Only derived boolean edge events
  (`face_visible`, `gaze_at_screen`, `motion`, `camera_state`) cross the
  wire. There is no image or video path to the Mac, by design.
- **Plugins are permission-gated but not sandboxed.** Each plugin runs in a
  `worker_thread` and reaches the network/OS only through a capability
  object; `exec` is pinned to a per-permission command allowlist
  (`EXEC_ALLOWLIST` in `packages/core/src/permissionEnforcer.ts`). However,
  `worker_threads` is **fault isolation, not a sandbox** — a malicious
  plugin could `require('child_process')` directly. Run only plugins you
  trust (i.e., ones in this repo or ones you wrote); a real sandbox is an
  explicit precondition for any future third-party plugin marketplace (see
  the Roadmap wiki page).
- **Secrets:** `config.json` is gitignored. It currently needs no API keys
  (weather is Open-Meteo, key-free) — a config value that adds one should
  stay out of version control.

Reports that weaken any of these stated properties (e.g. a way for a plugin
to escape the allowlist *within* the trust model, frames leaving the phone,
the gateway binding beyond loopback unexpectedly) are exactly what we want
to hear about. "The WebSocket has no auth" on its own is the documented
trust model rather than a vulnerability — but a report showing it's
reachable beyond the USB tunnel in a default setup absolutely is one.
