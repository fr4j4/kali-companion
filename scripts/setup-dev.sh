#!/usr/bin/env bash
# Development environment for Kali on Debian/Ubuntu (24.04+): system libraries, gtk4-layer-shell
# from source, JS dependencies and a Python venv. Does not build release binaries.
#
# Usage: scripts/setup-dev.sh [PREFIX]   (default PREFIX=$HOME/.local)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${1:-$HOME/.local}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

$SUDO apt-get update -qq
$SUDO apt-get install -y -qq build-essential pkg-config meson ninja-build git curl \
  libgtk-4-dev libwebkitgtk-6.0-dev libdbus-1-dev libwayland-dev wayland-protocols libwayland-bin \
  python3-venv xvfb wmctrl

# gtk4-layer-shell is not packaged on Ubuntu 24.04. Introspection is off: it is not needed by the
# Rust bindings and g-ir-scanner breaks with some Python versions.
if ! PKG_CONFIG_PATH="$PREFIX/lib/x86_64-linux-gnu/pkgconfig:$PREFIX/lib/pkgconfig" pkg-config --exists gtk4-layer-shell-0; then
  tmp="$(mktemp -d)"
  git clone -q --depth 1 --branch v1.1.0 https://github.com/wmww/gtk4-layer-shell "$tmp/gls"
  meson setup "$tmp/gls/build" "$tmp/gls" --prefix="$PREFIX" -Dexamples=false -Ddocs=false -Dtests=false -Dintrospection=false -Dvapi=false
  ninja -C "$tmp/gls/build" install
  rm -rf "$tmp"
fi

npm --prefix "$ROOT/kali-web" ci
npm --prefix "$ROOT/kali-shell" ci

python3 -m venv "$ROOT/kali-core/.venv"
"$ROOT/kali-core/.venv/bin/pip" install -q -e "$ROOT/kali-core[piper,dev]"

cat <<EOF

Done. In every shell that builds or runs kali-avatar:
  export PKG_CONFIG_PATH="$PREFIX/lib/x86_64-linux-gnu/pkgconfig:$PREFIX/lib/pkgconfig:\${PKG_CONFIG_PATH:-}"
  export LD_LIBRARY_PATH="$PREFIX/lib/x86_64-linux-gnu:$PREFIX/lib:\${LD_LIBRARY_PATH:-}"
Checks:
  (cd kali-avatar && cargo test)
  (cd kali-web && npm run typecheck && npm test)
  (cd kali-core && .venv/bin/python -m pytest -q)   # STT/TTS tests need Vosk and Piper models
EOF
