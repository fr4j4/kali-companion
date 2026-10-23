//! Shared configuration (`~/.config/kali/desktop.json`), written by kali-shell and read here.

use serde::Deserialize;
use std::path::PathBuf;
use std::time::SystemTime;

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AvatarPrefs {
    pub visible: bool,
    pub size: u32,
    pub corner: String,
    pub monitor: String,
    pub show_text: bool,
    /// Dragged position in logical pixels relative to the monitor origin; `None` = anchor to `corner`.
    pub x: Option<i32>,
    pub y: Option<i32>,
}

impl Default for AvatarPrefs {
    fn default() -> Self {
        Self { visible: true, size: 220, corner: "bottom-right".into(), monitor: String::new(), show_text: false, x: None, y: None }
    }
}

#[derive(Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub mode: String,
    pub backend_url: String,
    pub token: String,
    pub capability_token: String,
    pub avatar: AvatarPrefs,
}

pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("kali")
}

pub fn config_file() -> PathBuf {
    config_dir().join("desktop.json")
}

pub fn runtime_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp")).join("kali")
}

impl Config {
    pub fn load() -> Option<Config> {
        let raw = std::fs::read_to_string(config_file()).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn mtime() -> Option<SystemTime> {
        std::fs::metadata(config_file()).ok()?.modified().ok()
    }

    /// WebSocket endpoint of the core, derived from the backend origin.
    pub fn ws_url(&self) -> Option<String> {
        let base = if self.backend_url.is_empty() && self.mode == "local" {
            "http://127.0.0.1:8900"
        } else {
            self.backend_url.as_str()
        };
        let mut url = url::Url::parse(base).ok()?;
        let scheme = match url.scheme() {
            "https" => "wss",
            "http" => "ws",
            _ => return None,
        };
        url.set_scheme(scheme).ok()?;
        url.set_path("/ws");
        url.set_query(None);
        url.set_fragment(None);
        Some(url.to_string())
    }

    /// Connection-relevant fields: a change here forces a reconnect.
    pub fn link_key(&self) -> (String, String, String) {
        (self.ws_url().unwrap_or_default(), self.token.clone(), self.capability_token.clone())
    }
}

/// Read-modify-write one `avatar.<key>` field, leaving the rest of the shared file intact.
fn update_avatar(update: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>)) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let path = config_file();
    let mut root: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({ "version": 1 }));
    if !root.is_object() {
        root = serde_json::json!({ "version": 1 });
    }
    let avatar = root.as_object_mut().unwrap().entry("avatar").or_insert_with(|| serde_json::json!({}));
    if let Some(map) = avatar.as_object_mut() {
        update(map);
    }
    std::fs::create_dir_all(config_dir())?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec_pretty(&root)?)?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    std::fs::rename(tmp, path)
}

/// Persist `avatar.visible`.
pub fn save_visible(visible: bool) -> std::io::Result<()> {
    update_avatar(|m| {
        m.insert("visible".into(), serde_json::Value::Bool(visible));
    })
}

/// Persist the dragged position (`None` clears it and returns to the corner anchor).
pub fn save_position(pos: Option<(i32, i32)>) -> std::io::Result<()> {
    update_avatar(|m| match pos {
        Some((x, y)) => {
            m.insert("x".into(), x.into());
            m.insert("y".into(), y.into());
        }
        None => {
            m.remove("x");
            m.remove("y");
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_ws_url() {
        let c = Config { backend_url: "https://kali.example:8444".into(), ..Default::default() };
        assert_eq!(c.ws_url().as_deref(), Some("wss://kali.example:8444/ws"));
        let c = Config { backend_url: "http://127.0.0.1:8900/".into(), ..Default::default() };
        assert_eq!(c.ws_url().as_deref(), Some("ws://127.0.0.1:8900/ws"));
        assert_eq!(Config::default().ws_url(), None);
        let local = Config { mode: "local".into(), ..Default::default() };
        assert_eq!(local.ws_url().as_deref(), Some("ws://127.0.0.1:8900/ws"));
        let bad = Config { backend_url: "ftp://x".into(), ..Default::default() };
        assert_eq!(bad.ws_url(), None);
    }

    #[test]
    fn parses_shell_written_file() {
        let raw = r#"{"version":1,"mode":"remote","backendUrl":"https://a","token":"t","capabilityToken":"c",
            "avatar":{"visible":false,"size":300,"corner":"top-left","monitor":"DP-1","showText":true,"x":40,"y":60}}"#;
        let c: Config = serde_json::from_str(raw).unwrap();
        assert_eq!(c.avatar, AvatarPrefs { visible: false, size: 300, corner: "top-left".into(), monitor: "DP-1".into(), show_text: true, x: Some(40), y: Some(60) });
        let partial: Config = serde_json::from_str(r#"{"backendUrl":"https://a"}"#).unwrap();
        assert!(partial.avatar.visible && partial.avatar.size == 220);
    }
}
