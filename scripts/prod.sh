#!/usr/bin/env bash
# Build and launch the independent desktop client.
# The backend is started separately on its own machine.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT/kali-web"
SHELL_DIR="$ROOT/kali-shell"

if [ ! -d "$WEB_DIR/node_modules" ] || [ ! -d "$SHELL_DIR/node_modules" ]; then
  echo "Install dependencies in kali-web and kali-shell first (npm install)." >&2
  exit 1
fi

npm --prefix "$WEB_DIR" run build
npm --prefix "$SHELL_DIR" run build
cd "$SHELL_DIR"
exec ./node_modules/.bin/electron .
