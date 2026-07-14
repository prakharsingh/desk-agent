# Contributing

Thanks for considering a contribution to Desk Agent OS. This is a small,
opinionated project — please read this before opening a PR.

## Getting set up

See [SETUP.md](SETUP.md) for a from-zero build/run guide, and
[AGENTS.md](AGENTS.md) for the architecture map and the conventions that are
load-bearing rather than stylistic — read that before touching
`presenceEngine.ts`, the protocol schema, or anything under `apps/android/src/presence/`.

New to the codebase? **[docs/ONBOARDING.md](docs/ONBOARDING.md)** is the
guided tour (including how to contribute without the reference hardware),
and there are step-by-step guides for the two most common contributions:
[writing a plugin](docs/guides/writing-a-plugin.md) and
[adding a widget](docs/guides/adding-a-widget.md).

## Workflow

1. Fork the repo and branch off `main`. Branch names aren't enforced, but
   `feat/…`, `fix/…`, `docs/…` matching the change type is appreciated.
2. Make your change **test-first**. Every existing package here was built
   TDD; a PR that adds behavior without a failing-then-passing test for it
   will be asked to add one.
3. Before opening a PR:
   ```bash
   pnpm build
   pnpm test
   ```
   Both must be clean. There is no CI pipeline yet, so this local run is the
   actual gate — don't skip it because "it's a small change."
4. Match the surrounding code's style and idioms rather than introducing a
   new pattern for the same problem (see AGENTS.md's "load-bearing
   conventions" — e.g. the fake-timer idiom for timers in `packages/core`).
5. Open the PR against `main` with a description of *why*, not just *what* —
   especially for anything touching presence detection, where the reasoning
   behind a threshold or a fail-safe direction matters more than the diff.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) style is
preferred (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), matching
the repo's existing history. Not strictly enforced by tooling, but it's how
the CHANGELOG is written and it makes `git log` skimmable.

## What gets special scrutiny

- **Anything in `presenceEngine.ts`.** The failure mode of a bug here is a
  false auto-sleep while the user is quietly sitting at their desk. PRs that
  touch fail-to-present logic, hysteresis timing, or the fusion rules should
  explain the reasoning, not just show the diff.
- **Protocol changes** (`packages/protocol/src/schema.ts`). This is the one
  file both runtimes depend on. Additive changes (a new event/payload) are
  low-risk; anything that changes `PROTOCOL_VERSION` or an existing payload
  shape is a breaking change and should be called out explicitly as one.
- **Anything that adds a way for a plugin to reach outside its capability
  object (`ctx`)** — this repo's isolation model depends on plugins never
  bypassing it.

## Versioning & releases

The whole monorepo is versioned together as one product, via annotated git
tags (`vMAJOR.MINOR.PATCH`), independent of the individual (unpublished)
package.json versions under `packages/*`. Each roadmap "slice" — the unit
this project is built and shipped in — is a minor release: Slice 1a is
`v0.1.0`, Slice 1b is `v0.2.0`, and so on. Patch releases are reserved for
fixes that don't add a new slice's scope.

Every release gets a [CHANGELOG.md](CHANGELOG.md) entry under
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions before
the tag is cut, describing what shipped in terms someone who didn't watch the
PRs land can follow.

### Cutting a release (maintainers)

1. Bump versions to the new `X.Y.Z`: `apps/mac/package.json` `"version"`,
   and in `apps/android/android/app/build.gradle` set `versionName "X.Y.Z"`
   and increment `versionCode` by 1. (CI fails the release if the tag and
   these versions disagree.)
2. Finalize the `CHANGELOG.md` section header for `X.Y.Z` — the release body
   is extracted from it; CI fails if the section is missing.
3. Commit, then tag and push:
       git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main vX.Y.Z
4. CI (`release.yml`) runs the full test suite, packs the DMG, builds the
   signed APK, and creates a **draft** release. Nothing publishes on a red
   build.
5. Verify the draft: install the DMG on a Mac, sideload the APK on the
   reference phone (an upgrade over the previous version must not force an
   uninstall — if it does, the signing keystore changed: stop and
   investigate before publishing).
6. Publish the draft.
7. Update the Homebrew cask per `packaging/homebrew/README.md` (new
   `version` + `sha256`).

## Reporting issues

Open a GitHub issue. For anything presence/camera-related, please include
your Android device model and OS version — behavior here is documented to be
device/OEM-specific (see [AGENTS.md](AGENTS.md) and the
[wiki Hardware page](https://github.com/prakharsingh/desk-agent/wiki/Hardware)),
and "works on my 6T" bugs are a known category here.

## Security issues

Don't report vulnerabilities as public issues — see
[SECURITY.md](SECURITY.md) for the private reporting channel and an honest
statement of the project's trust model.

## Code of conduct

This project follows the Contributor Covenant — see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be respectful and assume good
faith.
