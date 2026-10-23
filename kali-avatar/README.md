# kali-avatar

Resident native desktop agent for Kali. It is the lightweight part of the desktop client:

- floating **avatar** (Wayland layer-shell, or a regular window on GNOME Wayland/X11)
- **tray** icon (StatusNotifierItem)
- **native actions** requested by the core: `launch_app`, `list_monitors`, `screenshot`
- starts the rich UI (`kali-shell`, Electron) **on demand**: `kali-shell --open=chat|artifacts|settings`

It keeps one presence-mode WebSocket to `kali-core` (no history replay) and renders the avatar with
the minimal `avatar.html` bundle of `kali-web` inside a transparent WebKitGTK view.
Design and rationale: [`docs/DESKTOP_NATIVE_ARCHITECTURE.md`](../docs/DESKTOP_NATIVE_ARCHITECTURE.md).

## Build and install

```bash
scripts/build-avatar.sh            # installs to ~/.local
kali-avatar --print-web-root       # check that the web bundle is found
```

Build dependencies (Debian/Ubuntu): `libgtk-4-dev libwebkitgtk-6.0-dev libdbus-1-dev` and
`gtk4-layer-shell` (build [wmww/gtk4-layer-shell](https://github.com/wmww/gtk4-layer-shell) if your
distro does not package it, then export `PKG_CONFIG_PATH`). Rust 1.80+.

## Configuration

Reads `~/.config/kali/desktop.json`, written by `kali-shell` (Settings → Cliente de escritorio):

```json
{ "version": 1, "mode": "remote", "backendUrl": "https://kali.example", "token": "...",
  "capabilityToken": "...",
  "avatar": { "visible": true, "size": 220, "corner": "bottom-right", "monitor": "", "showText": false } }
```

The file is created with mode `0600` and the tokens are stored in plain text, because the agent must
connect while Electron is not running. The agent re-reads the file every 2 s.

Environment: `KALI_AVATAR_WEB` (web bundle dir), `KALI_SHELL_CMD` (UI launcher, default `kali-shell`),
`KALI_AVATAR_NO_LAYER=1` (force a regular window), `KALI_AVATAR_DEBUG=1` (logs + inspector).
While running it keeps `$XDG_RUNTIME_DIR/kali/avatar.pid`, which `kali-shell` uses to hand over the avatar
and tray.

## Behaviour by environment

| Environment | Avatar | Notes |
| --- | --- | --- |
| Hyprland, Sway, other wlroots, KDE Wayland | layer-shell `top` layer anchored to a corner/monitor, no focus | needs `libgtk4-layer-shell` at runtime |
| GNOME Wayland | regular undecorated window | no layer-shell in Mutter; the compositor decides stacking/position |
| X11 | regular window; `wmctrl` (if installed) sets above/sticky and the corner | |

Screenshots shell out to `grim` / `spectacle` / `gnome-screenshot` (Wayland) or `maim` / `scrot` (X11).
If `libgtk4-layer-shell` must be loaded before libwayland, start with `LD_PRELOAD=/usr/lib/libgtk4-layer-shell.so`.

## Development

```bash
cargo test
# headless smoke test on X11 (no compositor needed):
KALI_AVATAR_WEB=../kali-web/dist KALI_AVATAR_DEBUG=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  xvfb-run -a cargo run
```
