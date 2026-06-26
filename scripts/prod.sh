#!/usr/bin/env bash
# Full-app launcher via kali-shell (Electron).
#
# kali-shell replaces the old kali-home (Tauri/Rust) shell. It opens a
# Chromium-backed BrowserWindow (GPU-accelerated on Wayland, no GTK3/
# WebKitGTK Error 71), spawns the Python sidecar (kali-core), and loads
# the kali-web frontend.
#
# Usage:  scripts/prod.sh
#
# Requirements (checked at startup):
#   - Wayland session with Hyprland (WAYLAND_DISPLAY,
#     HYPRLAND_INSTANCE_SIGNATURE, XDG_RUNTIME_DIR) for screen capture
#     via mss (XWayland backend).
#   - kali-core .venv with deps (auto-created if missing)
#   - kali-web node_modules (auto-installed if missing)
#   - kali-shell node_modules (auto-installed if missing)
#
# Architecture:
#   kali-shell (Electron main process)
#     ├── kali-web (Vite preview of production build on :5173)
#     ├── kali-core sidecar (spawned by sidecar.ts with KALI_PYTHON)
#     └── screen capture handled in-process by Python (mss) — no IPC
#
# The Electron BrowserWindow loads http://localhost:5173 (Vite preview).
# Screen capture (screenshot, list_monitors tools) runs inside the
# Python sidecar via the mss library — there is no IPC WS on :8901.
#
# Performance:
#   See docs/PERFORMANCE.md. Electron/Chromium handles Wayland + GPU
#   natively; no WEBKIT_DISABLE_COMPOSITING_MODE or GDK_BACKEND hacks.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DIR="$ROOT/kali-core"
SHELL_DIR="$ROOT/kali-shell"
WEB_DIR="$ROOT/kali-web"
VENV="$CORE_DIR/.venv"
LOG="/tmp/kali-prod.log"

# ── Environment validation ─────────────────────────────────
echo "[prod] Validating environment…"

# Auto-detect Wayland display if not set (common in uwsm sessions
# where vars aren't propagated to child processes).
if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
  echo "ERROR: XDG_RUNTIME_DIR is not set."
  exit 1
fi

if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  for sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    [ -S "$sock" ] || continue
    export WAYLAND_DISPLAY="$(basename "$sock")"
    echo "  Auto-detected WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
    break
  done
fi
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
  echo "ERROR: WAYLAND_DISPLAY is not set and no Wayland socket found."
  echo "  Are you in a Wayland session?"
  exit 1
fi

# Auto-detect Hyprland instance signature if not set.
if [ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then
  for hypr_dir in "$XDG_RUNTIME_DIR"/hypr/*/; do
    sig="$(basename "$hypr_dir")"
    if [ -n "$sig" ]; then
      echo "  Auto-detected HYPRLAND_INSTANCE_SIGNATURE=$sig"
      export HYPRLAND_INSTANCE_SIGNATURE="$sig"
      break
    fi
  done
fi
if [ -z "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]; then
  echo "ERROR: HYPRLAND_INSTANCE_SIGNATURE is not set and no Hyprland"
  echo "  socket found in \$XDG_RUNTIME_DIR/hypr/. Is Hyprland running?"
  exit 1
fi

# mss uses the X11 backend on Linux (via XWayland). Ensure DISPLAY is set.
if [ -z "${DISPLAY:-}" ]; then
  xdisplay="$(ps aux | grep 'Xwayland' | grep -v grep | sed 's/.*Xwayland[[:space:]]*\(:[0-9]*\).*/\1/' | head -1)"
  if [ -n "$xdisplay" ]; then
    export DISPLAY="$xdisplay"
    echo "  Auto-detected DISPLAY=$DISPLAY (XWayland)"
  fi
fi

# ── kali-core: ensure venv + deps ─────────────────────────
echo "[prod] Checking kali-core deps…"
if [ ! -d "$VENV" ]; then
  echo "  Creating kali-core venv…"
  python3 -m venv "$VENV"
fi

if [ ! -d "$VENV/lib/python"*/site-packages/kali_core ]; then
  echo "  Installing kali-core deps…"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -e "$CORE_DIR" piper-tts numpy scipy mss
fi

if ! "$VENV/bin/python" -c "import kali_core; print('  venv OK')" 2>/dev/null; then
  echo "ERROR: kali-core cannot be imported from venv."
  exit 1
fi

# ── STT models ────────────────────────────────────────────
if [ ! -d "$CORE_DIR/kali_core/ear/models/vosk-model-small-es-0.42" ]; then
  echo "  Downloading STT models…"
  bash "$ROOT/scripts/download-stt-models.sh"
fi

# ── kali-web: ensure node_modules ──────────────────────────
if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "  Installing kali-web deps…"
  npm --prefix "$WEB_DIR" install
fi

# ── kali-shell: ensure node_modules ─────────────────────────
if [ ! -d "$SHELL_DIR/node_modules" ]; then
  echo "  Installing kali-shell deps…"
  npm --prefix "$SHELL_DIR" install
fi

# ── Cleanup stale processes ──────────────────────────────
if lsof -ti tcp:8900 &>/dev/null; then
  echo "[prod] Killing stale process on :8900 (leftover kali-core)…"
  lsof -ti tcp:8900 | xargs kill 2>/dev/null || true
  sleep 0.5
fi

# ── Vite: build production assets, then serve via preview ──
BUILD_DIR="$WEB_DIR/dist"
NEED_BUILD=0

if [ "${KALI_REBUILD:-0}" = "1" ]; then
  NEED_BUILD=1
elif [ ! -d "$BUILD_DIR" ] || [ -z "$(ls -A "$BUILD_DIR" 2>/dev/null)" ]; then
  NEED_BUILD=1
else
  newest_src="$(find "$WEB_DIR/src" -type f -newer "$BUILD_DIR/index.html" 2>/dev/null | head -1)"
  newest_cfg=""
  for cfg in "$WEB_DIR/vite.config.ts" "$WEB_DIR/index.html" "$WEB_DIR/package.json" "$WEB_DIR/tailwind.config.ts" "$WEB_DIR/postcss.config.js"; do
    [ -f "$cfg" ] && [ "$cfg" -nt "$BUILD_DIR/index.html" ] && newest_cfg="$cfg" && break
  done
  if [ -n "$newest_src" ] || [ -n "$newest_cfg" ]; then
    NEED_BUILD=1
  fi
fi

if [ "$NEED_BUILD" = "1" ]; then
  echo "[prod] Building production frontend (vite build)…"
  npm --prefix "$WEB_DIR" run build
else
  echo "[prod] Reusing existing production build in $BUILD_DIR"
fi

if ! ss -tlnp 2>/dev/null | grep -q ':5173'; then
  echo "[prod] Starting Vite preview server (kali-web)…"
  npm --prefix "$WEB_DIR" run preview &>/tmp/kali-vite.log &
  VITE_PID=$!
  for i in $(seq 1 10); do
    if ss -tlnp 2>/dev/null | grep -q ':5173'; then
      echo "  Vite preview ready (PID $VITE_PID)"
      break
    fi
    sleep 1
  done
  if ! ss -tlnp 2>/dev/null | grep -q ':5173'; then
    echo "WARNING: Vite preview did not start on :5173 (check /tmp/kali-vite.log)"
  fi
else
  echo "[prod] Vite server already listening on :5173, reusing it"
fi

# ── Build kali-shell (TypeScript → JS) ─────────────────────
echo "[prod] Building kali-shell (TypeScript)…"
npm --prefix "$SHELL_DIR" run build

# ── Launch ────────────────────────────────────────────────
echo "[prod] Starting kali-shell (Electron)…"
echo "       Web:    http://localhost:5173  (Electron BrowserWindow)"
echo "       Core:   python (venv sidecar, spawned by kali-shell)"
echo "       Capture: mss (in-process Python, no IPC)"
echo "       Log:    $LOG"

export KALI_PYTHON="$VENV/bin/python"

trap 'echo "[prod] Shutting down…"; kill 0' EXIT

cd "$SHELL_DIR"
echo "[prod] Running electron (ctrl+c to stop)…"
npm start 2>&1 | tee -a "$LOG"