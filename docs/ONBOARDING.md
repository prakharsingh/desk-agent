# Contributor onboarding — a tour of the codebase

You've read the [README](../README.md) pitch and maybe run `pnpm install &&
pnpm build && pnpm test`. This is the guided tour for your first real change:
the mental model, where things live, how to work without the hardware, and
what a good first contribution looks like. It complements
[AGENTS.md](../AGENTS.md) (the terse architecture map + conventions — read it,
it's written for both humans and AI agents) and
[CONTRIBUTING.md](../CONTRIBUTING.md) (workflow/PR mechanics).

## The mental model: one loop

Everything in this repo hangs off a single data loop between two runtimes:

```
phone camera --MLKit--> signalDeriver (pure) --> edgeEmitter (pure, debounced)
  --sensor.* WS frame--> [Mac] wsGateway --> EventBus
    --> PresenceEngine (hysteresis fusion) --> person_present
      --> AutomationEngine --> energy-saver plugin --> pmset displaysleepnow
```

Widgets flow the other way: plugin worker → `widget.update` → WS broadcast →
the phone patches one card.

Three design commitments explain most of the code you'll read:

1. **The phone is a thin, honest sensor.** It never says "person present" —
   only what its camera literally observed this transition (`face_visible`,
   `gaze_at_screen`, `motion`, `camera_state`), debounced and edge-triggered.
   All judgment lives Mac-side in `packages/core/src/presenceEngine.ts`,
   where it gets full fake-timer test coverage.
2. **Fail toward `present`, never `absent`.** Camera error, link death,
   missing boot confirmation — all force the engine back to `present`. A
   false auto-sleep while someone sits reading is the failure this project
   is built to never have.
3. **Plugins only reach the world through `ctx`.** Declared permissions,
   per-permission exec allowlist, worker isolation.

## Repo tour, in reading order

| Path | What it is | README |
|---|---|---|
| `packages/protocol` | The wire contract (Zod). Read `src/schema.ts` first — it's small and everything else refers to it. | [→](../packages/protocol/README.md) |
| `packages/plugin-sdk` | `Plugin` + `Ctx` interfaces, fake host test harness. | [→](../packages/plugin-sdk/README.md) |
| `packages/plugins/*` | The three shipped plugins — smallest real examples of the whole model. | [→](../packages/plugins/README.md) |
| `packages/config-schema` | Node-free config schema shared by core and the Mac renderer. | [→](../packages/config-schema/README.md) |
| `packages/core` | The Mac-side brain: gateway, event bus, worker host, presence + automation engines, tunnel supervisor, watchdog. | [→](../packages/core/README.md) |
| `apps/android/` | The React Native phone app: dashboard UI + camera pipeline. | [→](../apps/android/README.md) |
| `apps/mac` | The Electron menu-bar app that runs the core for you. | [→](../apps/mac/README.md) |

Suggested first reading session (~1 hour): `protocol/src/schema.ts` →
`plugin-sdk/src/types.ts` → `plugins/weather/src/index.ts` →
`core/src/entrypoint.ts` → `core/src/presenceEngine.ts` (skim the tests —
they're the spec) → `apps/android/src/App.tsx`.

## Working without the hardware

You don't need a OnePlus 6T to contribute. What runs where:

- **`pnpm build && pnpm test`** — the entire Vitest suite (core, protocol,
  plugins, config-schema, and all of the app's pure logic) runs anywhere
  Node 20+ does. This is where presence logic, protocol changes, plugin
  work, and most display logic get developed and proven.
- **`cd apps/android && pnpm test:components`** — Jest RN component tests, also
  hardware-free.
- **Core agent standalone** — `node packages/core/dist/main.js` runs fine on
  any Mac; you'll see widgets update in the logs even with no phone.
- **Mac app** — `pnpm --filter @desk-agent/mac dev`.
- **What genuinely needs a device:** the camera pipeline (VisionCamera +
  MLKit is a native build; no Metro-only path), OEM background-kill
  behavior, thermal soak, and display wake — this is what SETUP.md's manual
  E2E checklist covers. If your change touches those, say what you did and
  didn't verify on hardware in the PR; "works on my 6T" device-specificity
  is a known, documented category here (see the
  [Hardware wiki page](https://github.com/prakharsingh/desk-agent/wiki/Hardware)).

## The three test runners (and why)

| Runner | Files | Run | Why separate |
|---|---|---|---|
| Vitest (root) | all `*.test.ts` | `pnpm test` | pure logic everywhere; can't parse RN's Flow source, so never `.tsx` |
| Jest (`apps/android/`) | `apps/android/src/**/*.test.tsx` | `cd apps/android && pnpm test:components` | real RN component rendering; `render`/`fireEvent` are async — always `await` |
| Gradle (`apps/android/android/`) | Kotlin JUnit/MockK/Robolectric | `./gradlew :app:testDebugUnitTest` | the two in-repo native modules |

Vitest resolves cross-package imports against **built `dist/`** — run
`pnpm build` after touching a package others import, or tests see stale
shapes. There's no CI: local green is the actual gate.

## Making your first change

Good first contributions, roughly in ascending ambition:

1. **Docs/wiki** — hardware compatibility notes if you run this on a
   different phone/Mac are explicitly wanted.
2. **A pure-logic fix or test** — formatters, readers, geometry, thresholds
   under `apps/android/src/display/` and `apps/android/src/presence/` are all pure `.ts` with
   focused tests.
3. **A new plugin** — the most self-contained real feature. Follow
   [guides/writing-a-plugin.md](guides/writing-a-plugin.md).
4. **A new widget** — plugin + phone renderer. Follow
   [guides/adding-a-widget.md](guides/adding-a-widget.md).

Workflow is test-first (every package here was built TDD), conventional
commits, `pnpm build && pnpm test` clean before the PR — details in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Where extra review scrutiny lands

Know these before you touch them (CONTRIBUTING.md has the full list):

- `presenceEngine.ts` — explain the *reasoning* for any threshold or
  fail-safe change, not just the diff.
- `packages/protocol/src/schema.ts` — additive is cheap; changing an
  existing shape or `PROTOCOL_VERSION` is a breaking change, call it out.
- `EXEC_ALLOWLIST` in `permissionEnforcer.ts` and anything that lets a
  plugin bypass `ctx` — this is the security boundary.
- Camera privacy — the privacy switch must *unmount* the camera (real
  session teardown, green dot off), never mute processing.

## Getting help

Open a GitHub issue (include device model + OS for anything camera/presence
related). The [wiki](https://github.com/prakharsingh/desk-agent/wiki) has
deeper architecture rationale, hardware notes, and troubleshooting.
