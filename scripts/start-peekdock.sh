#!/usr/bin/env bash
set -euo pipefail

cd /Users/karinadeng/Documents/peekdock

export PEEKDOCK_SERIAL_PORT="${PEEKDOCK_SERIAL_PORT:-/dev/cu.usbmodem1301}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-4173}"
export PEEKDOCK_HEADLESS="${PEEKDOCK_HEADLESS:-1}"

exec /usr/local/bin/node runtime-bridge/server.mjs
