//! Window listing and focusing through the tools each session already has: `hyprctl` (Hyprland),
//! `swaymsg` (Sway), `wmctrl`/`xprop` (X11). GNOME and KDE Wayland expose nothing a regular client
//! may use, so they report "unsupported" instead of guessing. Parsers are pure and tested.

use super::capture::{run, which};
use super::{Desktop, Session};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Window {
    /// Opaque id valid for `focus` (Hyprland address, Sway container id, X11 window id).
    pub id: String,
    pub title: String,
    pub app_id: String,
    pub focused: bool,
}

const MAX_TITLE: usize = 120;

fn clip(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect()
}

pub fn unsupported(session: Session, desktop: Desktop) -> String {
    match (session, desktop) {
        (Session::Wayland, Desktop::Gnome) => "GNOME on Wayland does not let applications list or focus other windows".into(),
        (Session::Wayland, Desktop::Kde) => "KDE Wayland has no window API available to this agent yet".into(),
        _ => "Window listing is not supported on this desktop".into(),
    }
}

pub fn list(session: Session, desktop: Desktop) -> Result<Vec<Window>, String> {
    match (session, desktop) {
        (Session::Wayland, Desktop::Hyprland) => {
            let clients = parse_hyprland(&String::from_utf8_lossy(&run("hyprctl", &["clients", "-j"])?), "")?;
            let active = run("hyprctl", &["activewindow", "-j"]).ok().and_then(|raw| serde_json::from_slice::<Value>(&raw).ok());
            let active = active.and_then(|v| v["address"].as_str().map(str::to_string)).unwrap_or_default();
            Ok(clients.into_iter().map(|mut w| {
                w.focused = w.id == active;
                w
            }).collect())
        }
        (Session::Wayland, Desktop::Sway) => parse_sway(&String::from_utf8_lossy(&run("swaymsg", &["-t", "get_tree"])?)),
        (Session::X11, _) | (Session::Unknown, _) if which("wmctrl") => {
            let active = run("xprop", &["-root", "_NET_ACTIVE_WINDOW"]).ok().and_then(|o| parse_xprop_active(&String::from_utf8_lossy(&o))).unwrap_or_default();
            Ok(parse_wmctrl(&String::from_utf8_lossy(&run("wmctrl", &["-lx"])?), &active))
        }
        (Session::X11, _) | (Session::Unknown, _) => Err("Install wmctrl to list windows on X11".into()),
        _ => Err(unsupported(session, desktop)),
    }
}

/// Focus a window from a fresh listing: only ids the compositor just reported are ever passed to
/// the focus command.
pub fn focus(session: Session, desktop: Desktop, id: &str) -> Result<(), String> {
    if !list(session, desktop)?.iter().any(|w| w.id == id) {
        return Err("Unknown window".into());
    }
    match (session, desktop) {
        (Session::Wayland, Desktop::Hyprland) => run("hyprctl", &["dispatch", "focuswindow", &format!("address:{id}")]).map(drop),
        (Session::Wayland, Desktop::Sway) => run("swaymsg", &[&format!("[con_id={id}]"), "focus"]).map(drop),
        (Session::X11, _) | (Session::Unknown, _) => run("wmctrl", &["-ia", id]).map(drop),
        _ => Err(unsupported(session, desktop)),
    }
}

pub fn parse_hyprland(raw: &str, active: &str) -> Result<Vec<Window>, String> {
    let v: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    Ok(v.as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter(|c| c["mapped"].as_bool().unwrap_or(true))
        .filter_map(|c| {
            let id = c["address"].as_str()?.to_string();
            Some(Window { focused: id == active, id, title: clip(c["title"].as_str().unwrap_or_default()), app_id: clip(c["class"].as_str().unwrap_or_default()) })
        })
        .collect())
}

pub fn parse_sway(raw: &str) -> Result<Vec<Window>, String> {
    fn walk(node: &Value, out: &mut Vec<Window>) {
        let is_window = node["pid"].is_number() && node["nodes"].as_array().map_or(true, |n| n.is_empty());
        if is_window {
            let app = node["app_id"].as_str().or_else(|| node["window_properties"]["class"].as_str()).unwrap_or_default();
            out.push(Window {
                id: node["id"].as_i64().map(|i| i.to_string()).unwrap_or_default(),
                title: clip(node["name"].as_str().unwrap_or_default()),
                app_id: clip(app),
                focused: node["focused"].as_bool().unwrap_or(false),
            });
        }
        for key in ["nodes", "floating_nodes"] {
            for child in node[key].as_array().into_iter().flatten() {
                walk(child, out);
            }
        }
    }
    let v: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    walk(&v, &mut out);
    out.retain(|w| !w.id.is_empty());
    Ok(out)
}

/// `wmctrl -lx`: `0x04400003  0 firefox.Firefox   host Some title`.
pub fn parse_wmctrl(raw: &str, active: &str) -> Vec<Window> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let id = parts.next()?.to_string();
            let desktop = parts.next()?;
            let class = parts.next()?;
            let _host = parts.next()?;
            if desktop == "-1" {
                return None; // panels and desktops, not application windows
            }
            let title = parts.collect::<Vec<_>>().join(" ");
            let focused = !active.is_empty() && u64::from_str_radix(id.trim_start_matches("0x"), 16).ok() == u64::from_str_radix(active.trim_start_matches("0x"), 16).ok();
            Some(Window { id, title: clip(&title), app_id: clip(class), focused })
        })
        .collect()
}

/// `_NET_ACTIVE_WINDOW(WINDOW): window id # 0x4400003`.
pub fn parse_xprop_active(raw: &str) -> Option<String> {
    raw.split('#').nth(1).map(|s| s.trim().to_string()).filter(|s| s.starts_with("0x"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hyprland_clients() {
        let raw = r#"[{"address":"0xaaa","mapped":true,"title":"Docs","class":"firefox"},{"address":"0xbbb","mapped":false,"title":"x","class":"y"},{"address":"0xccc","title":"Term\n","class":"kitty"}]"#;
        let w = parse_hyprland(raw, "0xccc").unwrap();
        assert_eq!(w.len(), 2);
        assert_eq!((w[0].id.as_str(), w[0].app_id.as_str(), w[0].focused), ("0xaaa", "firefox", false));
        assert!(w[1].focused);
        assert_eq!(w[1].title, "Term", "control characters are stripped");
    }

    #[test]
    fn parses_sway_tree_including_floating_and_xwayland() {
        let raw = r#"{"id":1,"nodes":[{"id":2,"nodes":[{"id":3,"pid":10,"app_id":"foot","name":"~","focused":true,"nodes":[],"floating_nodes":[]}],"floating_nodes":[{"id":4,"pid":11,"name":"Steam","window_properties":{"class":"Steam"},"nodes":[]}]}],"floating_nodes":[]}"#;
        let w = parse_sway(raw).unwrap();
        assert_eq!(w.iter().map(|w| (w.id.as_str(), w.app_id.as_str(), w.focused)).collect::<Vec<_>>(), vec![("3", "foot", true), ("4", "Steam", false)]);
    }

    #[test]
    fn parses_wmctrl_and_marks_the_active_window() {
        let raw = "0x04400003  0 firefox.Firefox   host Mozilla Firefox — docs\n0x01000001 -1 xfce4-panel.Xfce4-panel host Panel\n0x05000002  1 kitty.kitty host ~/src\n";
        let w = parse_wmctrl(raw, "0x5000002");
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].title, "Mozilla Firefox — docs");
        assert!(w[1].focused && !w[0].focused);
        assert_eq!(parse_xprop_active("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x5000002\n").as_deref(), Some("0x5000002"));
        assert_eq!(parse_xprop_active("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0"), Some("0x0".into()));
    }

    #[test]
    fn gnome_and_kde_wayland_say_why() {
        assert!(list(Session::Wayland, Desktop::Gnome).unwrap_err().contains("GNOME"));
        assert!(focus(Session::Wayland, Desktop::Kde, "1").unwrap_err().contains("KDE"));
    }
}
