# Desk Agent — macOS app shell

Electron app that hosts `@desk-agent/core` as a supervised UtilityProcess and will
expose all user settings natively. Phase 1 of the 5-phase plan (see
`docs/superpowers/specs/2026-07-13-phase0-*.md`, gitignored locally): the shell,
supervision, and packaging mechanics work end-to-end; the real config UI, status
channel, and 7 settings panes land in later phases.

```
pnpm --filter @desk-agent/mac dev     # electron-vite dev, live reload
pnpm --filter @desk-agent/mac pack    # build + build:native + electron-builder (ad-hoc signed unless an identity is set)
pnpm --filter @desk-agent/mac test    # vitest unit tests
pnpm --filter @desk-agent/mac test:native # Swift display-helper tests
pnpm --filter @desk-agent/mac test:e2e # packaged Playwright smoke test -- run `pack` first
```

Run `pnpm build` at the repo root before `pack`; otherwise it fails to resolve
`@desk-agent/protocol`. To sign with the stable identity, set
`DESK_AGENT_MAC_SIGN_IDENTITY=<sha1>` for `pack` and verify with
`node scripts/mac-signing/assert-signed.mjs "apps/mac/release/mac-arm64/Desk Agent.app"` —
see [packaging/MAC_SIGNING.md](../../packaging/MAC_SIGNING.md).

## Display helper

`native/display-helper` is a Swift package (macOS 14+, Swift 6) that builds
`desk-agent-display-helper`, the process behind the phone's extended display.
The app spawns one per session. It:

- creates a virtual display with the private `CGVirtualDisplay` API;
- captures it with ScreenCaptureKit and encodes H.264;
- serves the video on a loopback socket (`127.0.0.1:8788`) that the core
  forwards to the phone with `adb reverse`;
- turns the phone's touch input into mouse events with `CGEvent`.

`build:native` (run by `dev` and `pack`) compiles it and stages it in
`native-bin/`; `pack` ships it in `Contents/Helpers/`. `test:native` runs its
tests and forwards extra arguments to `swift test` (for example
`-- --filter FramingTests`). Two opt-in integration tests need an unlocked GUI
session: set `DESK_AGENT_VD_INTEGRATION=1` or `DESK_AGENT_CAPTURE_PROBE=1`
(see the header of `native/display-helper/scripts/test.sh`).

The display needs Screen Recording and Accessibility for Desk Agent; see
[PERMISSIONS.md](../../packages/core/macos-notes/PERMISSIONS.md). The per-phone
display identity macOS remembers is stored in `~/.desk-agent/display-identity.json`.

## Known TODOs for later phases

- **`package.json`'s `build.files`** (`["out/**/*", "node_modules/**/*"]`) packs the
  entire `node_modules` tree wholesale. This is fine today (three dependencies:
  `@desk-agent/core`, `react`, `react-dom`), but as real dependencies accumulate in
  Phase 2-4 this will either bloat the packaged app or — since `apps/mac/node_modules`
  is full of pnpm-store symlinks and a `workspace:*` link to `@desk-agent/core` — risk
  shipping symlinks that don't resolve once copied outside the monorepo (the exact
  failure mode the Phase 0 spike diagnosed; see the findings doc's "exact
  `asarUnpack`/`files` config to carry forward"). Revisit before Phase 5 packaging.
