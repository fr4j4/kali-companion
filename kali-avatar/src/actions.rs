//! Native desktop actions requested by the core (`desktop_action`): launch_app, list_monitors, screenshot.
//!
//! Capture and monitor listing shell out to the tool that matches the session instead of linking
//! heavy capture libraries, which keeps the resident binary small.

use base64::Engine;
use serde_json::{json, Value};
use std::process::Command;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug)]
pub struct Monitor {
    pub name: String,
    pub description: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub primary: bool,
}

pub type Monitors = Arc<Mutex<Vec<Monitor>>>;

pub const CAPABILITIES: [&str; 3] = ["launch_app", "list_monitors", "screenshot"];
const MAX_PNG_BYTES: usize = 12 * 1024 * 1024;

pub fn perform(action: &str, params: &Value, monitors: &Monitors) -> Result<Value, String> {
    match action {
        "launch_app" => launch_app(params),
        "list_monitors" => Ok(json!({ "monitors": list_monitors(monitors)? })),
        "screenshot" => screenshot(params, monitors),
        _ => Err("Unsupported desktop action".into()),
    }
}

pub fn valid_desktop_entry(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn launch_app(params: &Value) -> Result<Value, String> {
    let name = params.get("name").and_then(Value::as_str).ok_or("Invalid desktop entry")?;
    if !valid_desktop_entry(name) {
        return Err("Invalid desktop entry".into());
    }
    let status = Command::new("gtk-launch").arg(name).status().map_err(|e| format!("gtk-launch unavailable: {e}"))?;
    if !status.success() {
        return Err(format!("Could not launch {name}"));
    }
    Ok(json!({ "name": name, "message": format!("Launched {name}") }))
}

fn run(cmd: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = Command::new(cmd).args(args).output().map_err(|e| format!("{cmd} unavailable: {e}"))?;
    if !out.status.success() {
        return Err(format!("{cmd} failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout)
}

fn hyprland() -> bool {
    std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
}

fn list_monitors(monitors: &Monitors) -> Result<Vec<Value>, String> {
    if hyprland() {
        let raw = run("hyprctl", &["monitors", "-j"])?;
        let parsed: Vec<Value> = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
        return Ok(parsed
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let name = m["name"].as_str().unwrap_or_default();
                let focused = m["focused"].as_bool().unwrap_or(false);
                json!({
                    "id": i + 1, "name": name, "description": m["description"].as_str().unwrap_or(name),
                    "width": m["width"], "height": m["height"], "x": m["x"], "y": m["y"],
                    "primary": focused, "active": true, "focused": focused,
                    "refresh_rate": m["refreshRate"], "transform": m["transform"],
                })
            })
            .collect());
    }
    let snapshot = monitors.lock().map_err(|_| "monitor state poisoned")?;
    Ok(snapshot
        .iter()
        .enumerate()
        .map(|(i, m)| {
            json!({
                "id": i + 1, "name": m.name, "description": m.description, "width": m.width, "height": m.height,
                "x": m.x, "y": m.y, "primary": m.primary, "active": true, "focused": m.primary,
                "refresh_rate": 0, "transform": 0,
            })
        })
        .collect())
}

/// Resolve the `output` parameter ("primary", "secondary" or a monitor name) to a monitor name.
fn resolve_output(output: Option<&str>, monitors: &Monitors) -> Result<Option<Monitor>, String> {
    let list: Vec<Monitor> = if hyprland() {
        list_monitors(monitors)?
            .iter()
            .map(|m| Monitor {
                name: m["name"].as_str().unwrap_or_default().into(),
                description: String::new(),
                x: m["x"].as_i64().unwrap_or(0) as i32,
                y: m["y"].as_i64().unwrap_or(0) as i32,
                width: m["width"].as_i64().unwrap_or(0) as i32,
                height: m["height"].as_i64().unwrap_or(0) as i32,
                primary: m["primary"].as_bool().unwrap_or(false),
            })
            .collect()
    } else {
        monitors.lock().map_err(|_| "monitor state poisoned")?.clone()
    };
    match output {
        None | Some("primary") => Ok(list.iter().find(|m| m.primary).or(list.first()).cloned()),
        Some("secondary") => Ok(list.iter().find(|m| !m.primary).cloned()),
        Some(name) => list.iter().find(|m| m.name == name).cloned().map(Some).ok_or_else(|| "Unknown monitor".to_string()),
    }
}

fn which(cmd: &str) -> bool {
    std::env::var_os("PATH").map_or(false, |paths| std::env::split_paths(&paths).any(|dir| dir.join(cmd).is_file()))
}

fn screenshot(params: &Value, monitors: &Monitors) -> Result<Value, String> {
    let output = match params.get("output") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.as_str()),
        Some(_) => return Err("Invalid output".into()),
    };
    let target = resolve_output(output, monitors)?;
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
    let tmp = crate::config::runtime_dir().join(format!("shot-{}.png", std::process::id()));
    let _ = std::fs::create_dir_all(tmp.parent().unwrap());
    let tmp_str = tmp.to_string_lossy().to_string();

    let png = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        // KWin does not implement wlr-screencopy, so grim fails there: prefer spectacle on KDE
        // (full desktop, no portal prompt) and fall back to grim when it is missing or fails.
        let mut grim_args: Vec<&str> = Vec::new();
        if let Some(m) = &target {
            grim_args.extend(["-o", m.name.as_str()]);
        }
        grim_args.push("-");
        if desktop.contains("kde") && which("spectacle") {
            match run("spectacle", &["-b", "-n", "-f", "-o", &tmp_str]).and_then(|_| read_and_remove(&tmp)) {
                Ok(png) => png,
                Err(e) if which("grim") => run("grim", &grim_args).map_err(|g| format!("{e}; {g}"))?,
                Err(e) => return Err(e),
            }
        } else if which("grim") {
            run("grim", &grim_args)?
        } else if desktop.contains("gnome") && which("gnome-screenshot") {
            run("gnome-screenshot", &["-f", &tmp_str])?;
            read_and_remove(&tmp)?
        } else {
            return Err("No screenshot tool for this Wayland session (install grim, spectacle or gnome-screenshot)".into());
        }
    } else if which("maim") {
        match &target {
            Some(m) if m.width > 0 => {
                let geometry = format!("{}x{}+{}+{}", m.width, m.height, m.x, m.y);
                run("maim", &["-g", &geometry, &tmp_str])?;
            }
            _ => {
                run("maim", &[&tmp_str])?;
            }
        }
        read_and_remove(&tmp)?
    } else if which("scrot") {
        run("scrot", &["-o", &tmp_str])?;
        read_and_remove(&tmp)?
    } else {
        return Err("No screenshot tool for this X11 session (install maim or scrot)".into());
    };
    if png.is_empty() {
        return Err("Capture returned an empty image".into());
    }
    if png.len() > MAX_PNG_BYTES {
        return Err("Capture too large".into());
    }
    Ok(json!({ "png_base64": base64::engine::general_purpose::STANDARD.encode(png) }))
}

fn read_and_remove(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(path);
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs a live desktop session: `cargo test -- --ignored screenshot_live`.
    #[test]
    #[ignore]
    fn screenshot_live() {
        let m: Monitors = Default::default();
        let v = perform("screenshot", &json!({}), &m).expect("capture");
        assert!(v["png_base64"].as_str().unwrap().len() > 1000);
    }

    #[test]
    fn validates_desktop_entries() {
        assert!(valid_desktop_entry("org.mozilla.firefox"));
        assert!(valid_desktop_entry("code-oss"));
        assert!(!valid_desktop_entry(""));
        assert!(!valid_desktop_entry("a b"));
        assert!(!valid_desktop_entry("../x"));
        assert!(!valid_desktop_entry(&"a".repeat(101)));
    }

    #[test]
    fn rejects_unknown_actions_and_bad_params() {
        let m: Monitors = Default::default();
        assert!(perform("rm_rf", &json!({}), &m).is_err());
        assert!(perform("launch_app", &json!({ "name": "a;b" }), &m).is_err());
        assert!(perform("screenshot", &json!({ "output": 5 }), &m).is_err());
    }
}
