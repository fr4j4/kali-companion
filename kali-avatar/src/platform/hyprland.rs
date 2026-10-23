//! Hyprland IPC: global cursor position and monitor list (`hyprctl`).

use super::{capture, poll_cursor, Monitor};
use crate::link::ToUi;
use serde_json::Value;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

/// Poll the IPC socket for the pointer on a background thread.
pub fn start_cursor(ui: async_channel::Sender<ToUi>) -> Option<&'static str> {
    let (sig, runtime) = (std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE")?, std::env::var_os("XDG_RUNTIME_DIR")?);
    let socket = PathBuf::from(runtime).join("hypr").join(sig).join(".socket.sock");
    std::thread::spawn(move || poll_cursor(ui, move || cursor(&socket)));
    Some("hyprland")
}

fn cursor(socket: &PathBuf) -> Option<(i32, i32)> {
    let mut stream = UnixStream::connect(socket).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(200))).ok()?;
    stream.write_all(b"j/cursorpos").ok()?;
    let mut out = String::new();
    stream.read_to_string(&mut out).ok()?;
    parse_cursor(&out)
}

pub fn parse_cursor(raw: &str) -> Option<(i32, i32)> {
    let v: Value = serde_json::from_str(raw).ok()?;
    Some((v["x"].as_f64()? as i32, v["y"].as_f64()? as i32))
}

/// `hyprctl monitors -j`; the focused monitor is reported as primary.
pub fn monitors() -> Result<Vec<Monitor>, String> {
    let raw = capture::run("hyprctl", &["monitors", "-j"])?;
    parse_monitors(&raw)
}

pub fn parse_monitors(raw: &[u8]) -> Result<Vec<Monitor>, String> {
    let parsed: Vec<Value> = serde_json::from_slice(raw).map_err(|e| e.to_string())?;
    Ok(parsed
        .iter()
        .map(|m| {
            let name = m["name"].as_str().unwrap_or_default().to_string();
            Monitor {
                description: m["description"].as_str().unwrap_or(&name).to_string(),
                x: m["x"].as_i64().unwrap_or(0) as i32,
                y: m["y"].as_i64().unwrap_or(0) as i32,
                width: m["width"].as_i64().unwrap_or(0) as i32,
                height: m["height"].as_i64().unwrap_or(0) as i32,
                primary: m["focused"].as_bool().unwrap_or(false),
                refresh_rate: m["refreshRate"].as_f64().unwrap_or(0.0),
                transform: m["transform"].as_i64().unwrap_or(0),
                name,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cursorpos() {
        assert_eq!(parse_cursor(r#"{"x": 1280, "y": 720}"#), Some((1280, 720)));
        assert_eq!(parse_cursor("not json"), None);
    }

    #[test]
    fn parses_monitors() {
        let raw = br#"[{"name":"DP-1","description":"Dell","width":2560,"height":1440,"x":0,"y":0,"focused":true,"refreshRate":59.95,"transform":0},
                       {"name":"HDMI-A-1","width":1920,"height":1080,"x":2560,"y":0,"focused":false}]"#;
        let list = parse_monitors(raw).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].primary && !list[1].primary);
        assert_eq!(list[0].description, "Dell");
        assert_eq!(list[1].description, "HDMI-A-1");
        assert_eq!((list[1].x, list[1].width), (2560, 1920));
        assert!(parse_monitors(b"nope").is_err());
    }
}
