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
# Optional native avatar: start it when built (scripts/build-avatar.sh) so it owns avatar and tray.
if command -v kali-avatar >/dev/null 2>&1 && ! pgrep -x kali-avatar >/dev/null; then
  (kali-avatar >/dev/null 2>&1 &)
  sleep 1
fi
cd "$SHELL_DIR"
exec ./node_modules/.bin/electron .
