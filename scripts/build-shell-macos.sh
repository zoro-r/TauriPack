#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT_DIR/apps/packer-ui"
TAURI_DIR="$ROOT_DIR/apps/packer-core/src-tauri"
OUT_DIR="$ROOT_DIR/templates/macos"

mkdir -p "$OUT_DIR"

( cd "$UI_DIR" && pnpm run build )
( cd "$TAURI_DIR" && cargo tauri build )

APP_PATH="$TAURI_DIR/target/release/bundle/macos/HTML-EXE-Packer.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Build output not found: $APP_PATH" >&2
  exit 1
fi

rm -rf "$OUT_DIR/Base.app"
cp -R "$APP_PATH" "$OUT_DIR/Base.app"

echo "Shell app exported to: $OUT_DIR/Base.app"
