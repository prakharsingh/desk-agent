# Desk Agent — macOS app shell

Electron app that hosts `@desk-agent/core` as a supervised UtilityProcess and will
expose all user settings natively. Phase 1 of the 5-phase plan (see
`docs/superpowers/specs/2026-07-13-phase0-*.md`, gitignored locally): the shell,
supervision, and packaging mechanics work end-to-end; the real config UI, status
channel, and 7 settings panes land in later phases.

```
pnpm --filter @desk-agent/mac dev     # electron-vite dev, live reload
pnpm --filter @desk-agent/mac pack    # build + electron-builder (unsigned, local)
pnpm --filter @desk-agent/mac test    # vitest unit tests
pnpm --filter @desk-agent/mac test:e2e # packaged Playwright smoke test -- run `pack` first
```

## Known TODOs for later phases

- **`package.json`'s `build.files`** (`["out/**/*", "node_modules/**/*"]`) packs the
  entire `node_modules` tree wholesale. This is fine today (three dependencies:
  `@desk-agent/core`, `react`, `react-dom`), but as real dependencies accumulate in
  Phase 2-4 this will either bloat the packaged app or — since `apps/mac/node_modules`
  is full of pnpm-store symlinks and a `workspace:*` link to `@desk-agent/core` — risk
  shipping symlinks that don't resolve once copied outside the monorepo (the exact
  failure mode the Phase 0 spike diagnosed; see the findings doc's "exact
  `asarUnpack`/`files` config to carry forward"). Revisit before Phase 5 packaging.
