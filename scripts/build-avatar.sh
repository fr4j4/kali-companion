#!/usr/bin/env bash
# Build the native avatar agent and install it with the minimal web bundle.
#
# Usage: scripts/build-avatar.sh [PREFIX]   (default PREFIX=$HOME/.local)
#
# Build dependencies (Debian/Ubuntu): libgtk-4-dev libwebkitgtk-6.0-dev libdbus-1-dev
# plus gtk4-layer-shell (libgtk4-layer-shell-dev where packaged, otherwise build it from
# https://github.com/wmww/gtk4-layer-shell and export PKG_CONFIG_PATH).
# Runtime tools used for native actions: grim (wlroots) | spectacle (KDE) | gnome-screenshot,
# maim | scrot (X11), wmctrl (keeps the avatar on top under X11), gtk-launch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${1:-$HOME/.local}"

npm --prefix "$ROOT/kali-web" run build
cargo build --release --manifest-path "$ROOT/kali-avatar/Cargo.toml"

install -Dm755 "$ROOT/kali-avatar/target/release/kali-avatar" "$PREFIX/bin/kali-avatar"
rm -rf "$PREFIX/share/kali-avatar/web"
mkdir -p "$PREFIX/share/kali-avatar"
cp -r "$ROOT/kali-web/dist" "$PREFIX/share/kali-avatar/web"
install -Dm644 "$ROOT/kali-avatar/packaging/kali-avatar.service" "$PREFIX/share/kali-avatar/kali-avatar.service"
install -Dm644 "$ROOT/kali-avatar/packaging/kali-avatar.desktop" "$PREFIX/share/applications/kali-avatar.desktop"
if [ -f "$ROOT/kali-shell/icon.png" ]; then
  install -Dm644 "$ROOT/kali-shell/icon.png" "$PREFIX/share/icons/hicolor/512x512/apps/kali-companion.png"
fi
echo "Installed to $PREFIX. Start with: kali-avatar"
echo "As a user service: install -Dm644 $PREFIX/share/kali-avatar/kali-avatar.service ~/.config/systemd/user/kali-avatar.service && systemctl --user enable --now kali-avatar"
