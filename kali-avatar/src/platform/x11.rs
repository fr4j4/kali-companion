//! X11 backend: a regular ARGB window that `wmctrl` keeps above other windows, pointer from
//! `XQueryPointer`, captures with maim/scrot.

use super::{capture, poll_cursor, position, DesktopServices, DragMode, Monitor, Monitors, Surface};
use crate::config::{self, AvatarPrefs};
use crate::link::ToUi;
use std::path::Path;

pub struct X11Surface;

impl Surface for X11Surface {
    fn name(&self) -> &'static str {
        "x11"
    }

    fn drag_mode(&self) -> DragMode {
        DragMode::WindowManager
    }

    /// GTK4 cannot move toplevels: ask the window manager through wmctrl (when installed) to keep
    /// the avatar above other windows and in its corner. Best effort.
    fn place_initial(&self, prefs: &AvatarPrefs, monitors: &Monitors) {
        if std::env::var_os("DISPLAY").is_none() {
            return;
        }
        let target = monitors.lock().ok().and_then(|list| {
            list.iter().find(|m| !prefs.monitor.is_empty() && m.name == prefs.monitor).or(list.first()).cloned()
        });
        let Some(m) = target else { return };
        let (px, py) = position(prefs, (m.width, m.height));
        let (x, y) = (m.x + px, m.y + py);
        let (w, h) = (prefs.size as i32, prefs.size as i32 + 20);
        std::thread::spawn(move || {
            // The window must be mapped before the window manager accepts the request.
            std::thread::sleep(std::time::Duration::from_millis(600));
            let run = |args: &[&str]| std::process::Command::new("wmctrl").args(args).status();
            if run(&["-r", "Kali Avatar", "-b", "add,above,sticky,skip_taskbar,skip_pager"]).is_err() {
                eprintln!("[kali-avatar] wmctrl not found: install it to keep the avatar on top under X11");
                return;
            }
            let _ = run(&["-r", "Kali Avatar", "-e", &format!("0,{x},{y},{w},{h}")]);
        });
    }

    /// The window manager runs the move, so GTK never sees where the window ends up: poll wmctrl
    /// until the geometry settles and store it relative to the monitor.
    fn remember_moved(&self, origin: (i32, i32), ui: async_channel::Sender<ToUi>) {
        std::thread::spawn(move || {
            let read = || -> Option<(i32, i32)> {
                let out = std::process::Command::new("wmctrl").arg("-lG").output().ok()?;
                let text = String::from_utf8_lossy(&out.stdout).into_owned();
                let line = text.lines().find(|l| l.ends_with("Kali Avatar"))?;
                let f: Vec<&str> = line.split_whitespace().collect();
                Some((f.get(2)?.parse().ok()?, f.get(3)?.parse().ok()?))
            };
            let (mut last, mut stable) = (None, 0);
            for _ in 0..200 {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let now = read();
                if let Some((x, y)) = now {
                    let _ = ui.send_blocking(ToUi::Moved(x, y));
                }
                if now.is_some() && now == last { stable += 1 } else { stable = 0 }
                last = now;
                if stable >= 3 {
                    break;
                }
            }
            if let Some((x, y)) = last {
                let _ = config::save_position(Some(((x - origin.0).max(0), (y - origin.1).max(0))));
            }
        });
    }
}

pub struct X11Services;

impl DesktopServices for X11Services {
    fn name(&self) -> &'static str {
        "x11"
    }

    fn start_cursor(&self, ui: async_channel::Sender<ToUi>) -> Option<&'static str> {
        std::thread::spawn(move || {
            let Ok((conn, screen)) = x11rb::connect(None) else { return };
            use x11rb::connection::Connection;
            use x11rb::protocol::xproto::ConnectionExt;
            let root = conn.setup().roots[screen].root;
            poll_cursor(ui, move || {
                let reply = conn.query_pointer(root).ok()?.reply().ok()?;
                Some((reply.root_x as i32, reply.root_y as i32))
            });
        });
        Some("x11")
    }

    fn monitors(&self, snapshot: &Monitors) -> Result<Vec<Monitor>, String> {
        Ok(snapshot.lock().map_err(|_| "monitor state poisoned")?.clone())
    }

    fn screenshot(&self, target: Option<&Monitor>, tmp: &Path) -> Result<Vec<u8>, String> {
        capture::x11(target, tmp)
    }
}
