// Tauri commands — the OS-level actions the webview can invoke.

use crate::sidecar::SidecarPort;
use tauri::{AppHandle, Manager};

/// Return the port the Python sidecar is listening on.
#[tauri::command]
pub fn get_sidecar_port(handle: AppHandle) -> Option<u16> {
    handle
        .try_state::<SidecarPort>()
        .map(|state| state.0)
}

/// Return which screen-capture backend would actually succeed on this
/// machine. Honest: only reports a backend the code actually implements.
#[tauri::command]
pub async fn capture_backend() -> String {
    #[cfg(target_os = "linux")]
    {
        let is_hyprland = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
            && std::env::var_os("WAYLAND_DISPLAY").is_some();
        if is_hyprland {
            // Confirm grim is actually present; the backend needs it.
            if std::process::Command::new("grim")
                .arg("--version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok()
            {
                return "hyprland".to_string();
            }
            return "none".to_string();
        }
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            // Non-Hyprland Wayland: portal path only (no per-output capture).
            return "wayland-portal".to_string();
        }
    }
    "none".to_string()
}

/// Capture the full screen (or a specific output by name) and return
/// PNG bytes as base64.
#[tauri::command]
pub async fn capture_full(output: Option<String>) -> Result<String, String> {
    let png_bytes = crate::capture::capture_full(output.as_deref()).await?;
    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &png_bytes,
    );
    Ok(b64)
}

/// Enumerate monitors (Hyprland only) and return the list as a JSON
/// string.
#[tauri::command]
pub async fn list_monitors() -> Result<String, String> {
    crate::capture::list_monitors().await
}

/// Launch an application by its desktop entry name (Linux XDG).
///
/// Searches XDG application directories for a matching .desktop file,
/// parses the Exec line, and spawns the process detached from the
/// agent so it survives after the agent turn ends.
#[tauri::command]
pub async fn launch_app(name: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let desktop_name = if name.ends_with(".desktop") {
        name.clone()
    } else {
        format!("{name}.desktop")
    };

    let dirs: Vec<PathBuf> = vec![
        dirs::home_dir().unwrap_or_default().join(".local/share/applications"),
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];

    let mut desktop_path: Option<PathBuf> = None;
    for dir in &dirs {
        let candidate = dir.join(&desktop_name);
        if candidate.is_file() {
            desktop_path = Some(candidate);
            break;
        }
    }

    let path = desktop_path.ok_or_else(|| {
        format!("Application '{name}' not found in desktop entries")
    })?;

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read .desktop file: {e}"))?;

    // Parse the Exec= line and strip field codes (%f, %u, %F, %U, etc.).
    let exec_line = content
        .lines()
        .find(|line| line.starts_with("Exec="))
        .map(|line| line.trim_start_matches("Exec=").to_string())
        .ok_or_else(|| "No Exec line in .desktop file".to_string())?;

    let exec_clean = exec_line
        .split_whitespace()
        .filter(|arg| !arg.starts_with('%'))
        .collect::<Vec<_>>()
        .join(" ");

    // Spawn detached.
    use std::process::Command;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string());
    Command::new(&shell)
        .arg("-c")
        .arg(&exec_clean)
        .envs(std::env::vars())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch '{name}': {e}"))?;

    Ok(format!("Launched '{name}'"))
}