//! Wayland backends.
//!
//! - [`LayerSurface`]: wlr-layer-shell (Hyprland, Sway and other wlroots, KDE Plasma): `top` layer
//!   anchored to a corner of a chosen monitor, never takes focus.
//! - [`PlainSurface`]: regular undecorated window for compositors without layer-shell (GNOME). The
//!   compositor decides stacking and position; there is nothing to ask for.
//! - [`WaylandServices`]: cursor, monitors and captures, specialised per compositor.

use super::{capture, hyprland, kwin, Desktop, DesktopServices, DragMode, Monitor, Monitors, Surface};
use crate::link::ToUi;
use gtk4::{gdk, ApplicationWindow};
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use std::path::Path;

pub struct LayerSurface;

impl Surface for LayerSurface {
    fn name(&self) -> &'static str {
        "wayland-layer-shell"
    }

    fn init(&self, window: &ApplicationWindow) {
        window.init_layer_shell();
        window.set_layer(Layer::Top);
        window.set_namespace(Some("kali-avatar"));
        window.set_keyboard_mode(KeyboardMode::None);
    }

    /// Always anchor top-left and place with margins: that makes the dragged position exact.
    fn apply(&self, window: &ApplicationWindow, pos: (i32, i32), monitor: Option<&gdk::Monitor>) {
        for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
            window.set_anchor(edge, edge == Edge::Top || edge == Edge::Left);
        }
        window.set_margin(Edge::Left, pos.0);
        window.set_margin(Edge::Top, pos.1);
        window.set_monitor(monitor);
    }

    fn drag_mode(&self) -> DragMode {
        DragMode::Margins
    }

    fn move_to(&self, window: &ApplicationWindow, pos: (i32, i32)) {
        window.set_margin(Edge::Left, pos.0);
        window.set_margin(Edge::Top, pos.1);
    }
}

pub struct PlainSurface;

impl Surface for PlainSurface {
    fn name(&self) -> &'static str {
        "wayland-plain"
    }

    fn drag_mode(&self) -> DragMode {
        DragMode::WindowManager
    }
}

pub struct WaylandServices {
    pub desktop: Desktop,
}

impl DesktopServices for WaylandServices {
    fn name(&self) -> &'static str {
        match self.desktop {
            Desktop::Hyprland => "wayland-hyprland",
            Desktop::Sway => "wayland-sway",
            Desktop::Kde => "wayland-kde",
            Desktop::Gnome => "wayland-gnome",
            Desktop::Other => "wayland",
        }
    }

    /// Wayland clients only see the pointer over their own surface, so the compositor must tell us.
    /// GNOME and Sway expose no such API and keep the in-window tracking only.
    fn start_cursor(&self, ui: async_channel::Sender<ToUi>) -> Option<&'static str> {
        match self.desktop {
            Desktop::Hyprland => hyprland::start_cursor(ui),
            Desktop::Kde => {
                kwin::start(ui);
                Some("kwin")
            }
            _ => None,
        }
    }

    fn stop(&self) {
        if self.desktop == Desktop::Kde {
            kwin::stop();
        }
    }

    fn monitors(&self, snapshot: &Monitors) -> Result<Vec<Monitor>, String> {
        if self.desktop == Desktop::Hyprland {
            return hyprland::monitors();
        }
        Ok(snapshot.lock().map_err(|_| "monitor state poisoned")?.clone())
    }

    fn screenshot(&self, target: Option<&Monitor>, tmp: &Path) -> Result<Vec<u8>, String> {
        capture::wayland(self.desktop, target, tmp)
    }

    fn screenshot_region(&self, tmp: &Path) -> Result<Vec<u8>, String> {
        capture::region_wayland(self.desktop, tmp)
    }

    fn windows(&self) -> Result<Vec<super::windows::Window>, String> {
        super::windows::list(super::Session::Wayland, self.desktop)
    }

    fn focus_window(&self, id: &str) -> Result<(), String> {
        super::windows::focus(super::Session::Wayland, self.desktop, id)
    }
}
