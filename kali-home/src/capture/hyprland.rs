// Hyprland/wlroots screen capture via grim + hyprctl.
//
// `grim` is the standard Wayland screenshot utility. Unlike
// xdg-desktop-portal (ashpd), it can target a specific output by name
// (`-o <name>`) without an interactive picker and without portal
// permission prompts — so the agent can capture the monitor the user
// named without interrupting the flow.
//
// `hyprctl monitors -j` enumerates outputs (name, geometry, transform),
// which the agent surfaces to the user to pick the main/secondary
// monitor.

use std::process::Stdio;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// A single output as reported by `hyprctl monitors -j`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Monitor {
    pub id: i64,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub make: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub serial: String,
    pub x: i64,
    pub y: i64,
    #[serde(rename = "width", default)]
    pub width: i64,
    #[serde(rename = "height", default)]
    pub height: i64,
    #[serde(default)]
    pub refresh_rate: f64,
    #[serde(default)]
    pub transform: i64,
    /// True when the monitor is DPMS-on / not disabled.  Hyprland
    /// returns `disabled: bool` in `monitors -j` (reliable) and  
    /// `dpmsStatus: bool` in `monitors all -j`.  We check `!disabled`
    /// as the primary active indicator; dpmsStatus is a secondary
    /// signal.
    #[serde(default)]
    pub disabled: bool,
    /// `dpmsStatus` from `hyprctl monitors all -j` (may be absent in
    /// plain `-j` — defaults to false).
    #[serde(rename = "dpmsStatus", default)]
    pub dpms_status: bool,
    #[serde(rename = "focused", default)]
    pub focused: bool,
}

impl Monitor {
    /// Whether this monitor is considered active (enabled + not
    /// DPMS-off).  Uses `!disabled` (always present) plus
    /// `dpms_status` when available.  Falls back to just `!disabled`.
    pub fn is_active(&self) -> bool {
        !self.disabled && self.dpms_status
    }
}

/// Enumerate outputs by parsing `hyprctl monitors -j`.
///
/// Requires `HYPRLAND_INSTANCE_SIGNATURE` and `WAYLAND_DISPLAY` (and
/// `XDG_RUNTIME_DIR`) in the environment so hyprctl can reach the
/// Hyprland IPC socket.
pub async fn list_monitors() -> Result<Vec<Monitor>, String> {
    let output = Command::new("hyprctl")
        .arg("monitors")
        .arg("-j")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("failed to spawn hyprctl: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("hyprctl monitors failed: {stderr}"));
    }

    serde_json::from_slice::<Vec<Monitor>>(&output.stdout)
        .map_err(|e| format!("failed to parse hyprctl monitors JSON: {e}"))
}

/// Capture a specific output (by name) as PNG bytes.
///
/// Uses `grim -o <name> -t png -` so the PNG is streamed to stdout and
/// no temp file is written. If `output` is `None`, captures the whole
/// composition (all outputs composited).
pub async fn capture_via_grim(output: Option<&str>) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new("grim");
    cmd.arg("-t").arg("png");
    if let Some(name) = output {
        cmd.arg("-o").arg(name);
    }
    // `-` ⇒ write PNG to stdout.
    cmd.arg("-");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let result = cmd
        .output()
        .await
        .map_err(|e| format!("failed to spawn grim: {e}"))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        let hint = if stderr.is_empty() {
            String::from("unknown grim error")
        } else {
            stderr
        };
        return Err(format!("grim capture failed: {hint}"));
    }

    if result.stdout.is_empty() {
        return Err("grim produced no output".into());
    }
    Ok(result.stdout)
}

/// Resolve a user-facing alias ("primary"/"secondary") or output name
/// to a concrete output name known to Hyprland.
///
/// `primary` → the focused monitor (or the first active one if none
/// is focused). `secondary` → the first active monitor that is not the
/// primary. Any other string is treated as an output name and validated
/// against the list.
#[allow(dead_code)]
pub fn resolve_alias(
    monitors: &[Monitor],
    alias: &str,
) -> Result<Option<String>, String> {
    if alias.eq_ignore_ascii_case("primary") || alias.is_empty() {
        return Ok(Some(primary_monitor(monitors)?.name.clone()));
    }
    if alias.eq_ignore_ascii_case("secondary") {
        let primary = primary_monitor(monitors)?;
        return Ok(monitors
            .iter()
            .find(|m| m.is_active() && m.name != primary.name)
            .map(|m| m.name.clone()));
    }
    // Else: treat as a literal output name; validate.
    if monitors.iter().any(|m| m.name == alias) {
        return Ok(Some(alias.to_string()));
    }
    Err(format!(
        "unknown monitor '{alias}'. Available: {}",
        monitors
            .iter()
            .filter(|m| m.is_active())
            .map(|m| m.name.clone())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Pick the primary monitor: the focused one if any, else the first
/// active (not disabled), else the first overall.
#[allow(dead_code)]
pub fn primary_monitor(monitors: &[Monitor]) -> Result<&Monitor, String> {
    monitors
        .iter()
        .find(|m| m.focused)
        .or_else(|| monitors.iter().find(|m| m.is_active()))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitors found".to_string())
}

/// Summarize the monitor list for the agent / user as a compact map of
/// index → name + geometry, plus which one is primary.
#[allow(dead_code)]
pub fn summarize(monitors: &[Monitor]) -> Vec<HashMap<String, String>> {
    let primary = primary_monitor(monitors).ok();
    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let mut h = HashMap::new();
            h.insert("index".into(), i.to_string());
            h.insert("name".into(), m.name.clone());
            h.insert("description".into(), m.description.clone());
            h.insert("resolution".into(), format!("{}x{}", m.width, m.height));
            h.insert("offset".into(), format!("{},{}", m.x, m.y));
            h.insert("active".into(), m.is_active().to_string());
            h.insert(
                "role".into(),
                if primary.map(|p| p.name == m.name).unwrap_or(false) {
                    "primary".into()
                } else {
                    "secondary".into()
                },
            );
            h
        })
        .collect()
}