#!/usr/bin/env bash
# Called by .releaserc.json's exec prepareCmd AFTER set-version.mjs, so the
# artifacts carry the bumped version. Signing is driven by the
# DESK_AGENT_UPLOAD_* env vars resolved inside build.gradle; without them
# assembleRelease produces an unsigned APK (acceptable only outside CI).
set -euo pipefail

VERSION="${1:?usage: build-release-artifacts.sh <X.Y.Z>}"

pnpm --filter @desk-agent/mac run pack

if [ -z "${DESK_AGENT_UPLOAD_STORE_FILE:-}" ]; then
  echo "warning: DESK_AGENT_UPLOAD_STORE_FILE not set -- APK will be signed with the debug keystore, not the release key" >&2
fi
(cd apps/android/android && ./gradlew :app:assembleRelease)

mkdir -p dist
cp "apps/mac/release/DeskAgent-${VERSION}-mac-arm64.dmg" dist/
cp "apps/mac/release/DeskAgent-${VERSION}-mac-arm64.dmg.blockmap" dist/
cp "apps/android/android/app/build/outputs/apk/release/app-release.apk" "dist/desk-agent-${VERSION}.apk"
echo "staged release artifacts in dist/ for v${VERSION}"
