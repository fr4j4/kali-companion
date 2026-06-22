// Sidecar supervisor — spawns and supervises the kali-core Python process.
//
// The companion's brain lives in Python (kali-core). kali-home is
// responsible for launching that process, waiting for its WebSocket to be
// listening, and restarting it if it crashes.

use std::time::Duration;
use tauri::async_runtime::Receiver;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use tauri_plugin_shell::ShellExt;

/// Shared state: the port the sidecar is listening on.
pub struct SidecarPort(pub u16);

/// Port for the sidecar's WebSocket server.
/// Default 8900; override via KALI_CORE_PORT env.
fn sidecar_port() -> u16 {
    std::env::var("KALI_CORE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8900)
}

/// Spawn the Python sidecar and supervise it forever.
pub async fn spawn_and_supervise(handle: AppHandle) -> anyhow::Result<()> {
    let port = sidecar_port();
    log::info!("sidecar WS will listen on 127.0.0.1:{port}");

    handle.manage(SidecarPort(port));

    loop {
        match spawn_once(&handle, port) {
            Ok((mut rx, _child)) => {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Terminated(payload) => {
                            log::info!("kali-core terminated (code={:?})", payload.code);
                        }
                        CommandEvent::Stderr(line) => {
                            log::info!("[kali-core] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stdout(line) => {
                            log::info!("[kali-core] {}", String::from_utf8_lossy(&line));
                        }
                        _ => {}
                    }
                }
                log::warn!("sidecar exited; restarting in 1s");
            }
            Err(e) => {
                log::error!("sidecar spawn failed: {e}; retrying in 1s");
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

/// Spawn the Python sidecar once and return the event receiver + child.
fn spawn_once(
    handle: &AppHandle,
    port: u16,
) -> anyhow::Result<(Receiver<CommandEvent>, CommandChild)> {
    let shell = handle.shell();
    let ipc_port: u16 = std::env::var("KALI_HOME_IPC_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8901);

    // Which Python to use for the sidecar. KALI_PYTHON can point at a
    // venv binary (e.g. kali-core/.venv/bin/python). Default: `python`
    // from PATH (used by dev.sh standalone mode).
    let python_bin = std::env::var("KALI_PYTHON").unwrap_or_else(|_| "python".to_string());
    log::info!("sidecar python binary: {python_bin}");

    // Forward the display-server environment so the sidecar (and the
    // IPC server it talks to inside the same process tree) can reach
    // Hyprland/grim. If kali-home itself was launched without these,
    // capture simply won't work — that's reported honestly via the
    // `capture_backend` command instead of failing silently.
    // Use `nice` to lower kali-core's CPU priority so Dota 2 (or any
    // foreground game) always has scheduling priority. +10 means
    // "below normal" — the kernel gives it CPU only when idle cores exist.
    let cmd = shell.command("nice");
    let cmd = cmd
        .args(["-n", "10", &python_bin, "-m", "kali_core"])
        .env("KALI_WS_PORT", port.to_string())
        .env("KALI_HOME_IPC_PORT", ipc_port.to_string())
        .env("KALI_HOME_MODE", "tauri");

    let display_vars = [
        "WAYLAND_DISPLAY",
        "HYPRLAND_INSTANCE_SIGNATURE",
        "XDG_RUNTIME_DIR",
        "XDG_CURRENT_DESKTOP",
        "XDG_SESSION_TYPE",
        "DISPLAY",
    ];
    let mut cmd = cmd;
    for var in display_vars {
        if let Ok(val) = std::env::var(var) {
            if !val.is_empty() {
                cmd = cmd.env(var, val);
            }
        }
    }

    let (rx, child) = cmd.spawn()?;
    Ok((rx, child))
}