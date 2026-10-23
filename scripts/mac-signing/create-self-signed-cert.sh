#!/usr/bin/env bash
# Create the stable self-signed code-signing identity for Desk Agent.
#
#   create-self-signed-cert.sh <outdir>
#
# Writes <outdir>/desk-agent-signing.{key,cer,p12} plus a randomly generated
# <outdir>/desk-agent-signing.p12.password (dir 700, files 600) and prints the
# certificate's SHA-1 fingerprint -- that is DESK_AGENT_MAC_SIGN_IDENTITY.
# Never prints the private key or the password. Refuses to write inside the
# repository and refuses to overwrite an existing identity (rotating it makes
# every user re-grant Screen Recording + Accessibility; see
# packaging/MAC_SIGNING.md).
set -euo pipefail

OUTDIR="${1:?usage: create-self-signed-cert.sh <outdir>}"
CN="Desk Agent Self-Signed Code Signing"
BASE="desk-agent-signing"

# Prefer an OpenSSL 3+ (Homebrew) over macOS's LibreSSL, which lacks -addext/-legacy.
OPENSSL="${OPENSSL:-}"
if [ -z "$OPENSSL" ]; then
  for c in /opt/homebrew/opt/openssl@3/bin/openssl /opt/homebrew/bin/openssl /usr/local/opt/openssl@3/bin/openssl openssl; do
    if command -v "$c" >/dev/null 2>&1 && "$c" version | grep -q '^OpenSSL [3-9]'; then OPENSSL="$c"; break; fi
  done
fi
[ -n "$OPENSSL" ] || { echo "error: OpenSSL 3+ is required (brew install openssl@3)" >&2; exit 1; }

# Check the nearest existing ancestor BEFORE creating anything.
case "$OUTDIR" in /*) ;; *) OUTDIR="$PWD/$OUTDIR" ;; esac
PROBE="$OUTDIR"
while [ ! -d "$PROBE" ]; do PROBE="$(dirname "$PROBE")"; done
PROBE="$(cd "$PROBE" && pwd -P)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
case "$PROBE/" in
  "$REPO_ROOT"/*) echo "error: refusing to write signing material inside the repository ($REPO_ROOT)" >&2; exit 1 ;;
esac
if TOP="$(git -C "$PROBE" rev-parse --show-toplevel 2>/dev/null)"; then
  echo "error: refusing to write signing material inside a git work tree ($TOP)" >&2; exit 1
fi
CREATED_DIR=0
[ -d "$OUTDIR" ] || CREATED_DIR=1
mkdir -p "$OUTDIR"
OUTDIR="$(cd "$OUTDIR" && pwd -P)"
for f in key cer p12 p12.password; do
  [ ! -e "$OUTDIR/$BASE.$f" ] || { echo "error: $OUTDIR/$BASE.$f already exists -- refusing to rotate the identity" >&2; exit 1; }
done

umask 077
# Only tighten a directory this script created (never e.g. ~/Desktop).
[ "$CREATED_DIR" = 1 ] && chmod 700 "$OUTDIR"

"$OPENSSL" req -x509 -newkey rsa:3072 -nodes -days 9125 \
  -subj "/CN=$CN" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -keyout "$OUTDIR/$BASE.key" -out "$OUTDIR/$BASE.pem"
"$OPENSSL" x509 -in "$OUTDIR/$BASE.pem" -outform DER -out "$OUTDIR/$BASE.cer"

"$OPENSSL" rand -base64 32 | tr -d '\n' > "$OUTDIR/$BASE.p12.password"
# -legacy: macOS `security import` cannot read OpenSSL 3's default AES/PBKDF2 PKCS#12.
"$OPENSSL" pkcs12 -export -legacy \
  -inkey "$OUTDIR/$BASE.key" -in "$OUTDIR/$BASE.pem" \
  -name "$CN" \
  -out "$OUTDIR/$BASE.p12" \
  -passout "file:$OUTDIR/$BASE.p12.password"

rm -f "$OUTDIR/$BASE.pem"
chmod 600 "$OUTDIR/$BASE".*

SHA1="$("$OPENSSL" x509 -inform DER -in "$OUTDIR/$BASE.cer" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')"
echo "wrote $OUTDIR/$BASE.{key,cer,p12,p12.password}"
echo "SHA-1 fingerprint (DESK_AGENT_MAC_SIGN_IDENTITY): $SHA1"
