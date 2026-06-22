// Screen capture abstraction — returns PNG bytes.
//
// Each platform/display-server backend implements this trait.
// `select_backend()` picks the best available backend at runtime.
//
// On Linux/Wayland we prefer the Hyprland + grim path: grim can target
// a specific output by name without an interactive portal picker, and
// hyprctl enumerates monitors. The xdg-desktop-portal (ashpd) path is
// kept as a fallback for non-Hyprland compositors.

pub type CaptureResult = Result<Vec<u8>, String>;

#[cfg(target_os = "linux")]
pub mod hyprland;
#[cfg(target_os = "linux")]
pub mod wayland;

#[cfg(target_os = "linux")]
fn is_hyprland() -> bool {
    std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
        && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(target_os = "linux")]
fn is_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// Enumerate monitors (Hyprland only). Returns a JSON string so the
/// caller can forward it over IPC without depending on the struct shape.
pub async fn list_monitors() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        if is_hyprland() {
            let monitors = hyprland::list_monitors().await?;
            return serde_json::to_string(&monitors)
                .map_err(|e| format!("serialize monitors: {e}"));
        }
        return Err("monitor listing requires Hyprland (HYPRLAND_INSTANCE_SIGNATURE + WAYLAND_DISPLAY)".into());
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("list_monitors is Linux/Hyprland-only".into())
    }
}

/// Capture the full screen (composition) or a specific output by name.
/// `output = None` → whole composition.
pub async fn capture_full(output: Option<&str>) -> CaptureResult {
    #[cfg(target_os = "linux")]
    {
        if is_hyprland() {
            return hyprland::capture_via_grim(output).await;
        }
        if is_wayland() && output.is_none() {
            // Fallback to portal only when capturing the whole
            // composition (portal cannot target a named output).
            return wayland::capture_via_portal().await;
        }
    }
    let _ = output;
    Err("no capture backend available for this platform".into())
}