#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="$ROOT_DIR/.tools/espressif/python_env/idf5.5_py3.9_env/bin/python"
CONVERTER="$ROOT_DIR/managed_components/lvgl__lvgl/scripts/LVGLImage.py"
INPUT_DIR="${1:-$ROOT_DIR/assets/raw}"
OUTPUT_DIR="${2:-$ROOT_DIR/assets/lvgl}"

mkdir -p "$OUTPUT_DIR"

"$PYTHON_BIN" "$CONVERTER" \
  --ofmt C \
  --cf RGB565A8 \
  -o "$OUTPUT_DIR" \
  "$INPUT_DIR"

echo "LVGL assets generated in: $OUTPUT_DIR"
