#!/usr/bin/env bash
# Builds the Swift display helper and stages it in apps/mac/native-bin/.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PKG=native/display-helper
swift build -c release --package-path "$PKG"
BIN=$(swift build -c release --package-path "$PKG" --show-bin-path)
mkdir -p native-bin
cp "$BIN/desk-agent-display-helper" native-bin/
echo "staged native-bin/desk-agent-display-helper"
