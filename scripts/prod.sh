#!/usr/bin/env bash
# Full-app launcher via kali-home (Tauri).
#
# Unlike dev.sh (which skips the native shell), this script launches
# kali-home — the Rust/Tauri container that wraps the frontend, spawns
# the Python sidecar, and serves the IPC for screen capture. Use this
# when you need system-access features: screen capture (list_monitors,
# screenshot), launch_app, file dialogs, etc.
#
# Usage:  scripts/prod.sh
#
# Requirements (checked at startup):
#   - Wayland session with Hyprland (WAYLAND_DISPLAY,
#     HYPRLAND_INSTANCE_SIGNATURE, XDG_RUNTIME_DIR)
#   - grim + hyprctl installed (screen capture)
#   - kali-core .venv with deps (auto-created if missing)
#   - kali-web node_modules (auto-installed if missing)
#
# Architecture:
#   kali-home (cargo run, dev mode)
#     ├── kali-web (Vite preview of production build via :5173)
#     ├── kali-core sidecar (spawned by sidecar.rs with KALI_PYTHON)
#     └── IPC WS server on 127.0.0.1:KALI_HOME_IPC_PORT (default 8901)
#
# The Tauri webview loads http://localhost:5173 (Vite preview, which
# serves the optimized production bundle).  When the user asks for a
# screen capture, the agent calls list_monitors/screenshot via the
# Python → IPC WS → kali-home → grim/hyprctl path.
#
# Performance:
#   See docs/PERFORMANCE.md. This script serves the production build
#   of kali-web (vite preview) and enables GPU compositing when on a
#   pure Wayland session. Override behaviour with:
#     KALI_REBUILD=1      force a fresh `vite build` even if dist is fresh
#     KALI_FORCE_X11=1    force the X11/XWayland backend (disables GPU)
#     KALI_DISABLE_GPU=1  keep Wayland backend but disable GPU compositing

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_DIR="$ROOT/kali-core"
HOME_DIR="$ROOT/kali-home"
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
  # Auto-detect from Wayland socket in XDG_RUNTIME_DIR.
  for sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    [ -S "$sock" ] || continue        # skip .lock files
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

# GTK (used by Tauri's window) needs GDK_BACKEND to know which
# display backend to use.
#
# Performance note (see docs/PERFORMANCE.md §0.7):
#   When running on a pure Wayland session (XDG_SESSION_TYPE=wayland),
#   using GDK_BACKEND=wayland lets WebKitGTK use the GPU compositor,
#   which dramatically reduces CPU cost of backdrop-blur, drop-shadow
#   and animated SVG. We therefore prefer Wayland when available and
#   only fall back to XWayland (x11) when:
#     - the session is not Wayland, or
#     - the user forces it via KALI_FORCE_X11=1, or
#     - a previous run hit the "Error 71 / GBM buffer" issue and set
#       KALI_DISABLE_GPU=1.
#
# Auto-detect the XWayland display number if DISPLAY is not set (only
# needed when we end up on XWayland).
if [ -z "${DISPLAY:-}" ]; then
  xdisplay="$(ps aux | grep 'Xwayland' | grep -v grep | sed 's/.*Xwayland[[:space:]]*\(:[0-9]*\).*/\1/' | head -1)"
  if [ -n "$xdisplay" ]; then
    export DISPLAY="$xdisplay"
    echo "  Auto-detected DISPLAY=$DISPLAY (XWayland)"
  fi
fi

# Decide display backend + GPU compositing.
_session_type="${XDG_SESSION_TYPE:-}"
_force_x11="${KALI_FORCE_X11:-0}"
if [ "$_session_type" = "wayland" ] && [ "$_force_x11" != "1" ] && [ "${KALI_DISABLE_GPU:-0}" != "1" ]; then
  # Pure Wayland: use the native Wayland backend and keep GPU
  # compositing on (the fast path).
  export GDK_BACKEND="${GDK_BACKEND:-wayland}"
  # Do NOT set WEBKIT_DISABLE_COMPOSITING_MODE here; the default
  # (GPU enabled) is what we want.
  echo "  Wayland native session detected → GPU compositing ENABLED"
  _USE_GPU=1
else
  # XWayland or forced X11: fall back to X11 and disable GPU
  # compositing to avoid "Failed to create GBM buffer" errors.
  export GDK_BACKEND="${GDK_BACKEND:-x11}"
  export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
  echo "  Using XWayland/X11 → GPU compositing DISABLED (software paint)"
  _USE_GPU=0
fi

# grim + hyprctl must be installed for screen capture.
if ! command -v grim &>/dev/null; then
  echo "ERROR: grim not found in PATH.  Install grim for screen capture."
  echo "  Arch: sudo pacman -S grim"
  exit 1
fi

if ! command -v hyprctl &>/dev/null; then
  echo "ERROR: hyprctl not found in PATH.  Is Hyprland installed?"
  exit 1
fi

# ── GStreamer plugins (WebKitGTK audio) ────────────────────
# WebKitGTK needs autoaudiosink + pulsesrc for getUserMedia
# (microphone) and wavparse for WAV playback (TTS).  Install
# automatically if missing — names vary per distro.
if ! gst-inspect-1.0 autoaudiosink &>/dev/null || \
   ! gst-inspect-1.0 pulsesrc &>/dev/null; then
  echo "[prod] Installing GStreamer plugins (audio for WebKitGTK)…"
  if command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm gst-plugins-base gst-plugins-good
  elif command -v apt &>/dev/null; then
    sudo apt-get install -y gstreamer1.0-plugins-base \
      gstreamer1.0-plugins-good gstreamer1.0-pulseaudio
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y gstreamer1-plugins-base gstreamer1-plugins-good
  elif command -v zypper &>/dev/null; then
    sudo zypper install -y gstreamer-plugins-base gstreamer-plugins-good
  elif command -v apk &>/dev/null; then
    sudo apk add gst-plugins-base gst-plugins-good
  else
    echo "ERROR: GStreamer plugins missing and no package manager detected."
    echo "  Install gst-plugins-base and gst-plugins-good manually."
    exit 1
  fi
fi

# Verify the critical plugins are now available.
for _plugin in autoaudiosink pulsesrc wavparse; do
  if ! gst-inspect-1.0 "$_plugin" &>/dev/null; then
    echo "WARNING: GStreamer plugin '$_plugin' still missing after install."
  fi
done

# ── kali-core: ensure venv + deps ─────────────────────────
echo "[prod] Checking kali-core deps…"
if [ ! -d "$VENV" ]; then
  echo "  Creating kali-core venv…"
  python3 -m venv "$VENV"
fi

if [ ! -d "$VENV/lib/python"*/site-packages/kali_core ]; then
  echo "  Installing kali-core deps…"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -e "$CORE_DIR" piper-tts numpy scipy
fi

# Verify the python binary works and kali_core imports.
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

# ── Cleanup stale processes ──────────────────────────────
# Kill a previously launched kali-core on :8900 if present
# (dev.sh may have left one).
if lsof -ti tcp:8900 &>/dev/null; then
  echo "[prod] Killing stale process on :8900 (leftover kali-core)…"
  lsof -ti tcp:8900 | xargs kill 2>/dev/null || true
  sleep 0.5
fi

# Kill a previously launched kali-home if present (unlikely).
if lsof -ti tcp:8901 &>/dev/null; then
  echo "[prod] Killing stale process on :8901 (leftover kali-home IPC)…"
  lsof -ti tcp:8901 | xargs kill 2>/dev/null || true
  sleep 0.5
fi

# ── WebKit / rendering ────────────────────────────────────
# GPU compositing flag is now set above depending on Wayland vs XWayland
# (see the GDK_BACKEND block near the top of this script).
# If we are on the GPU path, WEBKIT_DISABLE_COMPOSITING_MODE is unset
# (enabled); if we are on the X11 path, it is set to 1 (disabled).
if [ "${_USE_GPU:-0}" = "1" ]; then
  # Ensure the env var is not lingering from a previous run that
  # disabled compositing.
  unset WEBKIT_DISABLE_COMPOSITING_MODE
fi

# ── Vite: build production assets, then serve them via preview ──
# Performance note (see docs/PERFORMANCE.md §0.1, §0.2, §0.3):
#   Serving the production build instead of the dev server removes
#   HMR overhead, inline sourcemaps and lets Rollup tree-shake +
#   minify + split vendor chunks. This is the single biggest win
#   for the WebKitGTK webview, whose JIT is more conservative than
#   Chrome's and chokes on the unoptimized dev bundle.
#
# We build once and then run `vite preview` on :5173 (same port the
# Tauri devUrl expects). Re-build only if the dist is stale or the
# user asks for a fresh build via KALI_REBUILD=1.

BUILD_DIR="$WEB_DIR/dist"
NEED_BUILD=0

if [ "${KALI_REBUILD:-0}" = "1" ]; then
  NEED_BUILD=1
elif [ ! -d "$BUILD_DIR" ] || [ -z "$(ls -A "$BUILD_DIR" 2>/dev/null)" ]; then
  NEED_BUILD=1
else
  # Rebuild if any source file is newer than the dist index.
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

# Start `vite preview` on :5173 if nothing is already listening there.
# preview serves the optimized dist with the same proxy rules as dev.
if ! ss -tlnp 2>/dev/null | grep -q ':5173'; then
  echo "[prod] Starting Vite preview server (kali-web)…"
  npm --prefix "$WEB_DIR" run preview &>/tmp/kali-vite.log &
  VITE_PID=$!
  # Wait up to 10 seconds for preview to start listening.
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

# ── Launch ────────────────────────────────────────────────
echo "[prod] Starting kali-home (Tauri)…"
echo "       Web:  http://localhost:5173  (Tauri webview)"
echo "       Core: python (venv sidecar, spawned by kali-home)"
echo "       IPC:  127.0.0.1:8901  (kali-home ↔ kali-core)"
echo "       Log:  $LOG"

cd "$HOME_DIR"

echo "[prod] Running cargo run (ctrl+c to stop)…"

export KALI_PYTHON="$VENV/bin/python"
export RUST_LOG="${RUST_LOG:-info}"

trap 'echo "[prod] Shutting down…"; kill 0' EXIT

cargo run 2>&1 | tee -a "$LOG"
