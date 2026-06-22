#!/usr/bin/env bash
# Dev launcher: starts kali-core and kali-web together (no kali-home).
#
# This mode skips the Rust/Tauri shell (kali-home), so the frontend runs
# in the browser via Vite's dev server.  Useful for rapid iteration on
# the frontend and Python brain.
#
# LIMITATION: Because kali-home is not launched, screen capture (kali-gaze)
# and other native features (launch_app, file dialogs) do NOT work.
# For full functionality (including capture), use:
#
#     scripts/prod.sh
#
# Usage: scripts/dev.sh
#
# Requires:
#   - Python 3.12+ (kali-core venv is auto-created on first run)
#   - Node 20+ (kali-web deps are auto-installed on first run)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DIR="$ROOT/kali-core"
WEB_DIR="$ROOT/kali-web"
VENV="$CORE_DIR/.venv"

# ── kali-core: ensure venv + deps ─────────────────────────
if [ ! -d "$VENV" ]; then
  echo "Creating kali-core venv…"
  python3 -m venv "$VENV"
fi

if [ ! -d "$VENV/lib/python"*/site-packages/kali_core ]; then
  echo "Installing kali-core deps…"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -e "$CORE_DIR" piper-tts numpy scipy
fi

# ── STT models ────────────────────────────────────────────
if [ ! -d "$CORE_DIR/kali_core/ear/models/vosk-model-small-es-0.42" ]; then
  echo "Downloading STT models…"
  bash "$ROOT/scripts/download-stt-models.sh"
fi

# ── kali-web: ensure node_modules ──────────────────────────
if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "Installing kali-web deps…"
  npm --prefix "$WEB_DIR" install
fi

# ── Launch ────────────────────────────────────────────────
echo "Starting kali-core on 0.0.0.0:8900…"
"$VENV/bin/python" -m kali_core &
CORE_PID=$!

echo "Starting kali-web on 0.0.0.0:5173 (HTTPS, /ws → core:8900)"
echo "  → Local:   https://localhost:5173"
echo "  → Network: https://$(hostname -I 2>/dev/null | awk '{print $1}'):5173"
npm --prefix "$WEB_DIR" run dev &
WEB_PID=$!

trap 'kill $CORE_PID $WEB_PID 2>/dev/null' EXIT
wait