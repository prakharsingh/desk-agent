#!/usr/bin/env bash
# Runs the display helper's Swift tests. Extra arguments go to `swift test` (e.g. --filter X).
#
# On a Command-Line-Tools-only Mac, swift-testing's @Test/@Suite macros fail to load unless the
# TestingMacros plugin is passed explicitly; with full Xcode (CI) plain `swift test` works, so the
# flag is added only when the CLT plugin exists and the active developer dir (DEVELOPER_DIR or
# xcode-select) is the CLT one: CI runners also ship the CLT, but their Xcode toolchain must not load it.
#
# Opt-in integration tests (need an unlocked GUI session; see Tests/DisplayHelperIntegrationTests):
#   DESK_AGENT_VD_INTEGRATION=1 scripts/test.sh --filter createsAppliesAndDestroysARealVirtualDisplay
#   DESK_AGENT_CAPTURE_PROBE=1  scripts/test.sh --filter captureProducesCompleteSamples
#     (run tools/animator meanwhile so the virtual display has changing content)
set -euo pipefail
PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLUGIN=/Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib
DEVDIR="${DEVELOPER_DIR:-$(xcode-select -p 2>/dev/null || true)}"

if [[ -f "$PLUGIN" && "$DEVDIR" == /Library/Developer/CommandLineTools* ]]; then
  exec swift test --package-path "$PKG" -Xswiftc -load-plugin-library -Xswiftc "$PLUGIN" "$@"
fi
exec swift test --package-path "$PKG" "$@"
