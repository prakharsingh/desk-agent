# Phase 0 spike — packaged-core proof (throwaway reference)

This package is **not** the real macOS app. It is the Phase 0 de-risking spike from
`docs/superpowers/specs/2026-07-13-phase0-electron-core-spike-findings.md` — kept as a
working reference for the config that proved out, not as a starting point to build on
directly.

Phase 1 builds the real app fresh at `apps/mac/` with electron-vite, a tray, a settings
window, and a single-instance lock — none of which exist here. This spike only proves:
`@desk-agent/core` boots inside a packaged `utilityProcess.fork()`, its plugins resolve
and initialize from inside `app.asar`, and the ws gateway binds — see the findings doc for
the full write-up and the exact `asarUnpack`/`files`/Electron-version config to carry
forward.

To rerun the proof:
```
pnpm install
pnpm --filter @desk-agent/protocol --filter @desk-agent/plugin-sdk \
  --filter @desk-agent/plugin-system-stats --filter @desk-agent/plugin-weather \
  --filter @desk-agent/plugin-energy-saver --filter @desk-agent/core build
cd apps/spike-electron
node_modules/.bin/electron-builder --mac dir --arm64
# then copy release/mac-arm64/DeskAgentSpike.app somewhere outside this repo and run its
# Contents/MacOS/DeskAgentSpike binary directly — running it from inside the repo risks
# require.resolve() escaping the asar into the real monorepo node_modules and masking a
# packaging bug (see findings doc).
```
