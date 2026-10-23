//! Platform layer: one place that detects the session (Wayland / X11, which compositor) and picks
//! the backend for everything that depends on it.
//!
//! Two small traits keep the rest of the agent environment-agnostic:
//! - [`Surface`]: how the avatar window is created, placed, stacked and dragged.
//! - [`DesktopServices`]: global cursor, monitors and screenshots.
//!
//! Backends live in their own modules and never import each other; shared helpers are in
//! [`capture`]. Nobody else reads `WAYLAND_DISPLAY`, `HYPRLAND_*` or `XDG_*` variables.
//!
//! Override for debugging: `KALI_AVATAR_BACKEND=x11|wayland` (forces the session type) and
//! `KALI_AVATAR_NO_LAYER=1` (regular window on Wayland).

pub mod caps;
pub mod capture;
mod hyprland;
mod kwin;
mod wayland;
mod x11;

use crate::config::AvatarPrefs;
use crate::link::ToUi;
use gtk4::{gdk, ApplicationWindow};
use serde_json::Value;
use std::path::Path;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MARGIN: i32 = 24;
const CURSOR_POLL: Duration = Duration::from_millis(33);

pub fn debug() -> bool {
    std::env::var_os("KALI_AVATAR_DEBUG").is_some()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Session {
    Wayland,
    X11,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Desktop {
    Hyprland,
    Sway,
    Kde,
    Gnome,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Env {
    pub session: Session,
    pub desktop: Desktop,
}

impl Env {
    pub fn detect() -> Env {
        Env::from_lookup(&|key| std::env::var(key).ok().filter(|v| !v.is_empty()))
    }

    /// Detection from an environment lookup (injectable for tests). Order: explicit override,
    /// `GDK_BACKEND=x11` (XWayland rescue mode), `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE=x11` / `DISPLAY`.
    pub fn from_lookup(get: &dyn Fn(&str) -> Option<String>) -> Env {
        let session = match get("KALI_AVATAR_BACKEND").as_deref() {
            Some("x11") => Session::X11,
            Some("wayland") => Session::Wayland,
            _ if get("GDK_BACKEND").as_deref() == Some("x11") => Session::X11,
            _ if get("WAYLAND_DISPLAY").is_some() => Session::Wayland,
            _ if get("XDG_SESSION_TYPE").as_deref() == Some("x11") || get("DISPLAY").is_some() => Session::X11,
            _ => Session::Unknown,
        };
        let current = get("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
        let desktop = if get("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
            Desktop::Hyprland
        } else if get("SWAYSOCK").is_some() {
            Desktop::Sway
        } else if current.contains("kde") {
            Desktop::Kde
        } else if current.contains("gnome") {
            Desktop::Gnome
        } else {
            Desktop::Other
        };
        Env { session, desktop }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Monitor {
    pub name: String,
    pub description: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub primary: bool,
    pub refresh_rate: f64,
    pub transform: i64,
}

/// Monitor snapshot refreshed by the UI thread from GDK and read by the action workers.
pub type Monitors = Arc<Mutex<Vec<Monitor>>>;

/// How a dragged avatar moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DragMode {
    /// The agent updates layer-shell margins itself and saves the final spot.
    Margins,
    /// The window manager / compositor runs the move.
    WindowManager,
}

/// The avatar window: creation, placement, stacking and dragging.
pub trait Surface {
    fn name(&self) -> &'static str;
    /// Called once, before the window is presented.
    fn init(&self, _window: &ApplicationWindow) {}
    /// Apply the position (relative to `monitor`) and the target monitor. Called on every preference change.
    fn apply(&self, _window: &ApplicationWindow, _pos: (i32, i32), _monitor: Option<&gdk::Monitor>) {}
    /// One-shot placement after the window exists (window managers that need to be asked).
    fn place_initial(&self, _prefs: &AvatarPrefs, _monitors: &Monitors) {}
    fn drag_mode(&self) -> DragMode;
    /// Move during a [`DragMode::Margins`] drag.
    fn move_to(&self, _window: &ApplicationWindow, _pos: (i32, i32)) {}
    /// After a [`DragMode::WindowManager`] drag started, learn where the window ended up.
    fn remember_moved(&self, _origin: (i32, i32), _ui: async_channel::Sender<ToUi>) {}
}

/// Session services that do not involve the avatar window.
pub trait DesktopServices: Send + Sync {
    fn name(&self) -> &'static str;
    /// Start pushing the global pointer position to the UI. Returns the source name, or `None`.
    fn start_cursor(&self, ui: async_channel::Sender<ToUi>) -> Option<&'static str>;
    fn stop(&self) {}
    /// Current monitors; `snapshot` is the GDK view, used when the compositor has no better source.
    fn monitors(&self, snapshot: &Monitors) -> Result<Vec<Monitor>, String>;
    /// PNG of the target monitor (or the whole desktop when `None`). `tmp` is a scratch file path.
    fn screenshot(&self, target: Option<&Monitor>, tmp: &Path) -> Result<Vec<u8>, String>;
}

pub struct Backend {
    pub surface: Rc<dyn Surface>,
    pub services: Arc<dyn DesktopServices>,
}

impl Backend {
    /// Needs GTK initialised (layer-shell support is queried from the display).
    pub fn detect() -> Backend {
        let env = Env::detect();
        let want_layer = std::env::var_os("KALI_AVATAR_NO_LAYER").is_none();
        let layer = env.session == Session::Wayland && want_layer && gtk4_layer_shell::is_supported();
        let (surface, services): (Rc<dyn Surface>, Arc<dyn DesktopServices>) = match env.session {
            Session::Wayland => {
                let surface: Rc<dyn Surface> = if layer { Rc::new(wayland::LayerSurface) } else { Rc::new(wayland::PlainSurface) };
                (surface, Arc::new(wayland::WaylandServices { desktop: env.desktop }))
            }
            Session::X11 | Session::Unknown => (Rc::new(x11::X11Surface), Arc::new(x11::X11Services)),
        };
        if !layer && env.session == Session::Wayland {
            eprintln!("[kali-avatar] layer-shell unavailable: using a regular window (compositor decides stacking/position)");
        }
        if debug() {
            eprintln!("[kali-avatar] platform: {env:?} surface={} services={}", surface.name(), services.name());
        }
        Backend { surface, services }
    }
}

/// Avatar position inside a monitor of `size`: the dragged `x`/`y` (clamped to the monitor) or the
/// configured corner.
pub fn position(prefs: &AvatarPrefs, monitor: (i32, i32)) -> (i32, i32) {
    let (w, h) = (prefs.size as i32, prefs.size as i32 + 20);
    let (mw, mh) = monitor;
    if let (Some(x), Some(y)) = (prefs.x, prefs.y) {
        return (x.clamp(0, (mw - w).max(0)), y.clamp(0, (mh - h).max(0)));
    }
    let x = if prefs.corner.ends_with("left") { MARGIN } else { mw - w - MARGIN };
    let y = if prefs.corner.starts_with("top") { MARGIN } else { mh - h - MARGIN };
    (x.max(0), y.max(0))
}

/// Poll `read` and forward changes of the pointer position to the UI until it goes away.
pub(crate) fn poll_cursor(ui: async_channel::Sender<ToUi>, mut read: impl FnMut() -> Option<(i32, i32)>) {
    let mut last = None;
    loop {
        std::thread::sleep(CURSOR_POLL);
        let current = read();
        if let Some((x, y)) = current {
            if current != last {
                last = current;
                if ui.send_blocking(ToUi::Cursor(x, y)).is_err() {
                    return;
                }
            }
        }
    }
}

/// Monitors as the JSON the core expects.
pub fn monitors_json(list: &[Monitor]) -> Vec<Value> {
    list.iter()
        .enumerate()
        .map(|(i, m)| {
            serde_json::json!({
                "id": i + 1, "name": m.name, "description": m.description, "width": m.width, "height": m.height,
                "x": m.x, "y": m.y, "primary": m.primary, "active": true, "focused": m.primary,
                "refresh_rate": m.refresh_rate, "transform": m.transform,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> Env {
        let map: HashMap<String, String> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Env::from_lookup(&|key| map.get(key).cloned())
    }

    fn prefs(corner: &str, x: Option<i32>, y: Option<i32>) -> AvatarPrefs {
        AvatarPrefs { corner: corner.into(), size: 220, x, y, ..Default::default() }
    }

    #[test]
    fn detects_hyprland_wayland() {
        let e = env(&[("WAYLAND_DISPLAY", "wayland-1"), ("XDG_SESSION_TYPE", "wayland"), ("HYPRLAND_INSTANCE_SIGNATURE", "abc"), ("DISPLAY", ":0")]);
        assert_eq!(e, Env { session: Session::Wayland, desktop: Desktop::Hyprland });
    }

    #[test]
    fn xwayland_display_does_not_make_it_x11() {
        let e = env(&[("WAYLAND_DISPLAY", "wayland-0"), ("DISPLAY", ":0"), ("XDG_CURRENT_DESKTOP", "KDE")]);
        assert_eq!(e, Env { session: Session::Wayland, desktop: Desktop::Kde });
    }

    #[test]
    fn detects_plain_x11_and_gnome_wayland() {
        assert_eq!(env(&[("DISPLAY", ":0"), ("XDG_SESSION_TYPE", "x11")]).session, Session::X11);
        let e = env(&[("WAYLAND_DISPLAY", "wayland-0"), ("XDG_CURRENT_DESKTOP", "ubuntu:GNOME")]);
        assert_eq!(e, Env { session: Session::Wayland, desktop: Desktop::Gnome });
        assert_eq!(env(&[("WAYLAND_DISPLAY", "wayland-0"), ("SWAYSOCK", "/run/sway")]).desktop, Desktop::Sway);
        assert_eq!(env(&[]).session, Session::Unknown);
    }

    #[test]
    fn overrides_force_the_session() {
        assert_eq!(env(&[("WAYLAND_DISPLAY", "w"), ("GDK_BACKEND", "x11")]).session, Session::X11);
        assert_eq!(env(&[("DISPLAY", ":0"), ("KALI_AVATAR_BACKEND", "wayland")]).session, Session::Wayland);
        assert_eq!(env(&[("WAYLAND_DISPLAY", "w"), ("KALI_AVATAR_BACKEND", "x11")]).session, Session::X11);
    }

    #[test]
    fn corner_positions() {
        assert_eq!(position(&prefs("bottom-right", None, None), (1920, 1080)), (1920 - 220 - 24, 1080 - 240 - 24));
        assert_eq!(position(&prefs("top-left", None, None), (1920, 1080)), (24, 24));
    }

    #[test]
    fn dragged_position_is_clamped_to_the_monitor() {
        assert_eq!(position(&prefs("top-left", Some(100), Some(200)), (1920, 1080)), (100, 200));
        assert_eq!(position(&prefs("top-left", Some(5000), Some(-9)), (1920, 1080)), (1700, 0));
    }
}
