#!/usr/bin/env bash
# CI: import the Desk Agent self-signed signing identity into a temporary
# keychain and export DESK_AGENT_MAC_SIGN_IDENTITY / DESK_AGENT_MAC_SIGN_KEYCHAIN
# to later steps via $GITHUB_ENV.
#
# Fails if the imported certificate's SHA-1 differs from the one pinned in
# signPlan.mjs (override: DESK_AGENT_MAC_SIGN_EXPECTED_SHA1, for rotation).
#
# Needs: MAC_SIGN_P12_B64 (base64 of desk-agent-signing.p12),
#        MAC_SIGN_P12_PASSWORD, RUNNER_TEMP, GITHUB_ENV.
# The keychain is deleted by the workflow's final `if: always()` step.
set -euo pipefail

: "${MAC_SIGN_P12_B64:?MAC_SIGN_P12_B64 is not set -- see packaging/MAC_SIGNING.md}"
: "${MAC_SIGN_P12_PASSWORD:?MAC_SIGN_P12_PASSWORD is not set -- see packaging/MAC_SIGNING.md}"
: "${GITHUB_ENV:?GITHUB_ENV is not set (run inside GitHub Actions)}"

WORK="${RUNNER_TEMP:-$(mktemp -d)}"
KEYCHAIN="$WORK/desk-agent-signing.keychain-db"
P12="$WORK/desk-agent-signing.p12"
trap 'rm -f "$P12"' EXIT
KC_PASS="$(openssl rand -base64 24)"
echo "::add-mask::$KC_PASS"

umask 077
printf '%s' "$MAC_SIGN_P12_B64" | base64 --decode > "$P12"

security create-keychain -p "$KC_PASS" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KC_PASS" "$KEYCHAIN"
security import "$P12" -k "$KEYCHAIN" -f pkcs12 -P "$MAC_SIGN_P12_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KEYCHAIN" >/dev/null
# Prepend to the user search list so codesign finds the identity.
# shellcheck disable=SC2046
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
rm -f "$P12"

SHA1="$(security find-certificate -c "Desk Agent Self-Signed Code Signing" -Z "$KEYCHAIN" | awk '/^SHA-1 hash:/ {print $3; exit}')"
[ -n "$SHA1" ] || { echo "::error::signing certificate not found in the imported keychain"; exit 1; }

# The imported certificate must be the committed identity (or the deliberate
# rotation override), otherwise the release would silently invalidate every
# user's privacy grants. Case-insensitive.
EXPECTED="$(node --input-type=module -e \
  'const m = await import(process.argv[1]); console.log(m.expectedCertSha1());' \
  "file://$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/signPlan.mjs")"
if [ "$(printf '%s' "$SHA1" | tr '[:lower:]' '[:upper:]')" != "$EXPECTED" ]; then
  echo "::error::imported certificate SHA-1 $SHA1 does not match the expected $EXPECTED -- see 'Backup, loss and rotation' in packaging/MAC_SIGNING.md"
  exit 1
fi

# Verifies the identity (certificate + private key) was imported. codesign
# signs with an untrusted self-signed leaf as long as the key is reachable, so
# no add-trusted-cert is needed (packaging/MAC_SIGNING.md); `find-identity`
# without -v lists untrusted identities too, so this does not prove trust.
security find-identity -p codesigning "$KEYCHAIN" | grep -q "$SHA1" \
  || { echo "::error::imported certificate is not usable as a codesigning identity"; exit 1; }

echo "DESK_AGENT_MAC_SIGN_IDENTITY=$SHA1" >> "$GITHUB_ENV"
echo "DESK_AGENT_MAC_SIGN_KEYCHAIN=$KEYCHAIN" >> "$GITHUB_ENV"
echo "imported signing identity $SHA1 into $KEYCHAIN"
