#!/usr/bin/env bash
# Dev launcher: starts kali-core and kali-web together (no native shell).
#
# This mode skips the Electron shell (kali-shell), so the frontend runs
# in the browser via Vite's dev server.  Useful for rapid iteration on
# the frontend and Python brain.
#
# LIMITATION: Because the native shell is not launched, screen capture
# (kali-gaze) and other native features do NOT work.  For full
# functionality (including capture), use:
#
#     scripts/prod.sh
#
#
# Usage: scripts/dev.sh [--reload]
#
# Requires:
#   - Python 3.12+ (kali-core venv is auto-created on first run)
#   - Node 20+ (kali-web deps are auto-installed on first run)
set -euo pipefail

RELOAD=0
for arg in "$@"; do
  if [ "$arg" = "--reload" ]; then
    RELOAD=1
  fi
done
export KALI_DEV_RELOAD=$RELOAD

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DIR="$ROOT/kali-core"
WEB_DIR="$ROOT/kali-web"
VENV="$CORE_DIR/.venv"

# ── Load .env if present (so KALI_TTS_PROVIDER is available) ──
if [ -f "$CORE_DIR/.env" ]; then
  set -a
  source "$CORE_DIR/.env"
  set +a
fi

# ── Check Qwen3-TTS binary ──────────────────────────────────
QWEN_BUILD_DIR="$CORE_DIR/kali_core/voice/qwen_cpp/build"
if [ "${KALI_TTS_PROVIDER:-inproc}" = "qwen3" ] || [ "${KALI_TTS_PROVIDER:-inproc}" = "qwen3-voicedesign" ]; then
  if [ ! -f "$QWEN_BUILD_DIR/tts-server" ]; then
    echo "WARNING: Qwen3-TTS binary not found at $QWEN_BUILD_DIR/tts-server"
    echo "  To compile:  ./scripts/build-qwen-cpp.sh cpu"
    echo "  To download: ./scripts/download-qwen-models.sh"
    echo "  Falling back to Piper (inproc). Set KALI_TTS_PROVIDER=inproc in .env to silence this warning."
    export KALI_TTS_PROVIDER=inproc
  fi
fi

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

# ── kali-web: ensure node_modules ──────────────────────────
if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "Installing kali-web deps…"
  npm --prefix "$WEB_DIR" install
fi

# ── Launch ────────────────────────────────────────────────
if [ "$RELOAD" = "1" ]; then
  echo "Starting kali-core on 0.0.0.0:8900 (reload on)…"
else
  echo "Starting kali-core on 0.0.0.0:8900…"
fi
"$VENV/bin/python" -m kali_core &
CORE_PID=$!

# Wait for kali-core to be ready before starting Vite. Otherwise the
# browser loads the frontend before the core is listening, producing
# spurious CORS/connection-refused errors on /voices and /ws that
# only disappear after a manual refresh.
CORE_URL="http://127.0.0.1:8900/health"
echo "Waiting for kali-core ($CORE_URL)…"
for i in $(seq 1 60); do
  if curl -sf "$CORE_URL" >/dev/null 2>&1; then
    echo "  kali-core ready (after ${i}s)"
    break
  fi
  if ! kill -0 "$CORE_PID" 2>/dev/null; then
    echo "ERROR: kali-core exited before becoming ready."
    exit 1
  fi
  sleep 1
done
if ! curl -sf "$CORE_URL" >/dev/null 2>&1; then
  echo "WARNING: kali-core not ready after 60s, starting Vite anyway."
fi

echo "Starting kali-web on 0.0.0.0:5173 (HTTP, /ws → core:8900)"
echo "  → Local:   http://localhost:5173"
echo "  → Network: http://$(hostname -I 2>/dev/null | awk '{print $1}'):5173"
npm --prefix "$WEB_DIR" run dev &
WEB_PID=$!

trap 'kill $CORE_PID $WEB_PID 2>/dev/null' EXIT
wait