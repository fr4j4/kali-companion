//! Global pointer position, so the avatar's eyes can follow the cursor over other windows.
//!
//! Wayland clients only receive pointer events while the pointer is over their own surface, so the
//! position comes from the compositor: Hyprland's IPC socket, an X11 `XQueryPointer`, or a small
//! KWin script that reports the cursor over D-Bus (KDE Plasma Wayland). Other compositors (GNOME,
//! Sway) expose no such API and keep the in-window tracking only.

use crate::link::ToUi;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

const POLL: Duration = Duration::from_millis(33);

pub fn debug() -> bool {
    std::env::var_os("KALI_AVATAR_DEBUG").is_some()
}

/// Start the polling source that matches the session, if any. KWin pushes through D-Bus instead
/// (see `kwin.rs`), so it needs no thread here. Returns the name of the source for logging.
pub fn spawn(ui: async_channel::Sender<ToUi>) -> Option<&'static str> {
    if let (Some(sig), Some(runtime)) = (std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE"), std::env::var_os("XDG_RUNTIME_DIR")) {
        let socket = PathBuf::from(runtime).join("hypr").join(sig).join(".socket.sock");
        std::thread::spawn(move || poll(ui, move || hyprland(&socket)));
        return Some("hyprland");
    }
    let x11_session = std::env::var("XDG_SESSION_TYPE").map(|t| t == "x11").unwrap_or(false)
        || (std::env::var_os("WAYLAND_DISPLAY").is_none() && std::env::var_os("DISPLAY").is_some());
    if x11_session {
        std::thread::spawn(move || {
            let Ok((conn, screen)) = x11rb::connect(None) else { return };
            use x11rb::connection::Connection;
            use x11rb::protocol::xproto::ConnectionExt;
            let root = conn.setup().roots[screen].root;
            poll(ui, move || {
                let reply = conn.query_pointer(root).ok()?.reply().ok()?;
                Some((reply.root_x as i32, reply.root_y as i32))
            });
        });
        return Some("x11");
    }
    None
}

fn poll(ui: async_channel::Sender<ToUi>, mut read: impl FnMut() -> Option<(i32, i32)>) {
    let mut last = None;
    loop {
        std::thread::sleep(POLL);
        let current = read();
        if current.is_some() && current != last {
            last = current;
            let (x, y) = current.unwrap();
            if ui.send_blocking(ToUi::Cursor(x, y)).is_err() {
                return;
            }
        }
    }
}

fn hyprland(socket: &PathBuf) -> Option<(i32, i32)> {
    let mut stream = UnixStream::connect(socket).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(200))).ok()?;
    stream.write_all(b"j/cursorpos").ok()?;
    let mut out = String::new();
    stream.read_to_string(&mut out).ok()?;
    parse_hyprland(&out)
}

pub fn parse_hyprland(raw: &str) -> Option<(i32, i32)> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    Some((v["x"].as_f64()? as i32, v["y"].as_f64()? as i32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hyprland_cursorpos() {
        assert_eq!(parse_hyprland(r#"{"x": 1280, "y": 720}"#), Some((1280, 720)));
        assert_eq!(parse_hyprland("not json"), None);
    }
}
