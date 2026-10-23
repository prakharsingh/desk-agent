# macOS code signing (self-signed, stable identity)

## Why

macOS privacy grants (Screen & System Audio Recording, Accessibility) are
stored by TCC against the app's **designated requirement** (DR), not its path.

- An **ad-hoc** signature (`codesign --sign -`) has a DR pinned to the
  `cdhash` — the hash of that exact build. Every rebuild or update changes it,
  so every update silently invalidates the user's grants.
- A signature from a **stable certificate** has a DR pinned to that
  certificate's hash plus the bundle identifier. It is identical across
  builds, so grants survive updates.

Desk Agent is not notarized and has no Apple Developer ID, so it signs with a
long-lived (25-year) self-signed certificate,
`CN=Desk Agent Self-Signed Code Signing`.

The signing itself lives in `scripts/mac-signing/`: `afterPack.mjs` signs the
bundle inside-out (`sign.mjs`, `signPlan.mjs`) with
`DESK_AGENT_MAC_SIGN_IDENTITY` (CN or SHA-1) from an optional
`DESK_AGENT_MAC_SIGN_KEYCHAIN`, and falls back to ad-hoc when no identity is
set — unless `DESK_AGENT_REQUIRE_SIGNED=1`, which makes a missing identity an
error. `assert-signed.mjs` checks the packaged app's DRs.

## Generating the certificate (once, by the owner)

```bash
scripts/mac-signing/create-self-signed-cert.sh ~/.desk-agent-signing
```

Writes `desk-agent-signing.{key,cer,p12,p12.password}` (dir 700, files 600),
prints the SHA-1 fingerprint, and never prints the key or password. It refuses
to write inside a git work tree and refuses to overwrite an identity in the same
directory (the real rotation guard is the pinned SHA-1, see below).
Requires OpenSSL 3+ (Homebrew); the `.p12` is exported with `-legacy` because
macOS `security import` cannot read OpenSSL 3's default PKCS#12 encryption.

Current identity SHA-1: `B8B3F4B81BF50F599521EC37EB83ABBB76E86EB2`. It is
committed as `EXPECTED_CERT_SHA1` in `scripts/mac-signing/signPlan.mjs` (public,
not a secret). `assert-signed.mjs` rejects any designated requirement pinned to
another certificate, and `ci-import-cert.sh` fails when the imported `.p12`'s
SHA-1 differs, so a wrong or rotated secret cannot ship silently.

## Local signing

```bash
security import ~/.desk-agent-signing/desk-agent-signing.p12 \
  -k ~/Library/Keychains/login.keychain-db -f pkcs12 \
  -P "$(cat ~/.desk-agent-signing/desk-agent-signing.p12.password)" \
  -T /usr/bin/codesign

DESK_AGENT_MAC_SIGN_IDENTITY=B8B3F4B81BF50F599521EC37EB83ABBB76E86EB2 \
  pnpm --filter @desk-agent/mac run pack
node scripts/mac-signing/assert-signed.mjs "apps/mac/release/mac-arm64/Desk Agent.app"
```

### Trust variant (Task 0.3 Step 3 finding)

**No trust step is needed.** On macOS 27.0.1 (build 26A434), with the identity
imported into the login keychain with `-T /usr/bin/codesign`, codesign signed
all 25 code objects non-interactively even though
`security find-identity -p codesigning` reports the cert as
`CSSMERR_TP_NOT_TRUSTED` (and `-v` lists 0 valid identities). No keychain
access dialog appeared. `security add-trusted-cert` was **not** run, locally
or in CI.

Consequence: because the cert is untrusted, codesign anchors the DR on the
**leaf** hash rather than the root:

```
designated => identifier "com.deskagent.mac" and certificate leaf = H"b8b3f4b81bf50f599521ec37eb83abbb76e86eb2"
```

For a single self-signed certificate leaf == root, so this is exactly as
stable. Do not add trust (`add-trusted-cert`) on any signing machine: doing so
flips the DR text between `leaf` and `root`. `requirement.mjs` accepts either `certificate root = H"…"` or
`certificate leaf = H"…"` and rejects `cdhash` / unanchored DRs.

## CI (release.yml)

Secrets (repository → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `MAC_SIGN_P12_B64` | `base64 -i ~/.desk-agent-signing/desk-agent-signing.p12` |
| `MAC_SIGN_P12_PASSWORD` | contents of `~/.desk-agent-signing/desk-agent-signing.p12.password` |

On a non-dry run, the "Import mac signing cert" step runs
`scripts/mac-signing/ci-import-cert.sh`: it decodes the `.p12` into a temporary
keychain under `$RUNNER_TEMP`, sets its partition list for codesign, prepends it
to the user search list, and exports `DESK_AGENT_MAC_SIGN_IDENTITY` (SHA-1) and
`DESK_AGENT_MAC_SIGN_KEYCHAIN` through `$GITHUB_ENV`. The "Release" step sets
`DESK_AGENT_REQUIRE_SIGNED=1`, so `scripts/build-release-artifacts.sh` runs
`assert-signed.mjs` right after packing and an ad-hoc build cannot be released.
A final `if: always()` step deletes the temporary keychain. Dry runs need none
of these secrets and pack ad-hoc.

## Backup, loss and rotation

- Keep an **offline backup** of `desk-agent-signing.p12` **and** its password in
  the owner's password manager. The GitHub secrets are write-only and are not
  a backup.
- If the identity is lost or rotated, the DR changes. Every user must then
  re-grant Screen & System Audio Recording and Accessibility once (remove the
  stale Desk Agent entry, add it again). Never rotate casually.
- **Deliberate rotation procedure:** generate the new identity, update the
  `MAC_SIGN_P12_B64` / `MAC_SIGN_P12_PASSWORD` secrets, and change
  `EXPECTED_CERT_SHA1` in `scripts/mac-signing/signPlan.mjs` (and the SHA-1
  above) in one reviewed commit. Until that commit lands, CI fails at the import
  step and at `assert-signed`. For a one-off build (for example testing the new
  cert before committing), set `DESK_AGENT_MAC_SIGN_EXPECTED_SHA1=<new SHA-1>`
  in the environment; it overrides the constant for both `assert-signed.mjs` and
  `ci-import-cert.sh`.

## Reading `codesign -d -r-`

```bash
codesign -d -r- "/path/to/Desk Agent.app"
codesign -d -r- "/path/to/Desk Agent.app/Contents/Helpers/desk-agent-display-helper"
```

- `designated => cdhash H"…"` — ad-hoc; grants will not survive a rebuild.
- `designated => identifier "com.deskagent.mac" and certificate leaf|root = H"…"`
  — stable; the hash must equal the identity's SHA-1 (lower-case).
- The helper must show `identifier "com.deskagent.mac.display-helper"`.

## TCC persistence test (Task 0.4 Step 6, spec §6.6)

**Deviation from the plan (ruling P0-3):** the test does **not** install into
`/Applications`, which would overwrite the owner's live Desk Agent. It runs from
a non-repo copy of the worktree release build, launched with `open`
(LaunchServices), never as a terminal child — a terminal launch attributes TCC
to the terminal and passes falsely. This is weaker evidence than the
`/Applications` path.

### Part 1 — designated requirement is stable across versions (established)

macOS 27.0.1 (26A434), 2026-10-23. Both packed with
`DESK_AGENT_MAC_SIGN_IDENTITY=B8B3F4B81BF50F599521EC37EB83ABBB76E86EB2 pnpm --filter @desk-agent/mac exec electron-builder --mac -c.extraMetadata.version=<v>`:

| | v0.0.1 | v0.0.2 |
|---|---|---|
| app CDHash | `82a89889f4316883c3a5620e441ea101f297f894` | `3548eb8377f8aa2d83643cce58466653645fb8e9` |
| app DR blob sha256 | `9609636b…8477` | `9609636b…8477` |
| helper DR blob sha256 | `56494785…faec` | `56494785…faec` |

The builds differ (different CDHash) while `codesign -d -r-` is byte-identical
for the app and the display helper (`cmp` on both the text and the binary
requirement blob):

```
designated => identifier "com.deskagent.mac" and certificate leaf = H"b8b3f4b81bf50f599521ec37eb83abbb76e86eb2"
designated => identifier "com.deskagent.mac.display-helper" and certificate leaf = H"b8b3f4b81bf50f599521ec37eb83abbb76e86eb2"
```

### Part 2 — a grant survives the v1 → v2 replacement (pending, owner)

Needs a human grant. Each launch logs one Logs-pane line from source
`permissions`, e.g. `v0.0.2 screen-recording=granted accessibility=true`.
Read it right after launch: the Logs pane keeps only the newest 500 lines, so a
chatty session can evict it.

1. Quit Desk Agent. Open the v1 copy with `open "<dir>/v1/Desk Agent.app"`
   (choose "Open Anyway" in Privacy & Security if Gatekeeper asks).
2. System Settings › Privacy & Security › Screen & System Audio Recording → add
   that Desk Agent; Accessibility → add it. Quit, relaunch with `open`; the Logs
   pane must show `v0.0.1 screen-recording=granted accessibility=true`.
3. Quit. Replace the v1 bundle in place with the v2 bundle (same path), open it
   with `open`. **PASS** iff the Logs pane shows
   `v0.0.2 screen-recording=granted accessibility=true` with no re-grant.

Result: _not yet run_. A FAIL does not block: Task 5.5's stale-grant flow
handles it.
