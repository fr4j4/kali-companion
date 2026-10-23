//! Native desktop actions requested by the core (`desktop_action`): launch_app, list_monitors, screenshot.
//!
//! Monitor listing and capture go through [`DesktopServices`], so this module has no
//! compositor-specific code.

use crate::platform::{self, DesktopServices};
use base64::Engine;
use serde_json::{json, Value};

pub use crate::platform::{Monitor, Monitors};

/// `local_consent` is not an action: it tells the core that this agent asks the user itself, so the
/// core must not show a second card for the same request. `consent_ui` says it can also show the
/// cards for the core's own tools (`consent_request` with `native`), so they appear on the desktop.
pub const CAPABILITIES: [&str; 8] = ["launch_app", "find_apps", "list_monitors", "screenshot", "list_windows", "focus_window", "local_consent", "consent_ui"];
const MAX_PNG_BYTES: usize = 12 * 1024 * 1024;

pub fn perform(action: &str, params: &Value, monitors: &Monitors, services: &dyn DesktopServices) -> Result<Value, String> {
    match action {
        "launch_app" => launch_app(params),
        "find_apps" => crate::apps::find(params),
        "list_monitors" => Ok(json!({ "monitors": platform::monitors_json(&services.monitors(monitors)?) })),
        "screenshot" => screenshot(params, monitors, services),
        "list_windows" => list_windows(services),
        "focus_window" => {
            let id = params.get("id").and_then(Value::as_str).filter(|id| valid_window_id(id)).ok_or("Invalid window id")?;
            services.focus_window(id)?;
            Ok(json!({ "focused": id }))
        }
        _ => Err("Unsupported desktop action".into()),
    }
}

pub fn valid_desktop_entry(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

/// Window ids are hex addresses or numbers; anything else never reaches a command line.
pub fn valid_window_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_hexdigit() || c == 'x')
}

fn list_windows(services: &dyn DesktopServices) -> Result<Value, String> {
    let windows: Vec<Value> = services
        .windows()?
        .into_iter()
        .map(|w| json!({ "id": w.id, "title": w.title, "app_id": w.app_id, "focused": w.focused }))
        .collect();
    Ok(json!({ "windows": windows }))
}

fn launch_app(params: &Value) -> Result<Value, String> {
    let name = params.get("name").and_then(Value::as_str).ok_or("Invalid desktop entry")?;
    if !valid_desktop_entry(name) {
        return Err("Invalid desktop entry".into());
    }
    crate::apps::launch(name)
}

/// Resolve the `output` parameter ("primary", "secondary" or a monitor name) to a monitor.
fn resolve_output(output: Option<&str>, list: &[Monitor]) -> Result<Option<Monitor>, String> {
    match output {
        None | Some("primary") => Ok(list.iter().find(|m| m.primary).or(list.first()).cloned()),
        Some("secondary") => Ok(list.iter().find(|m| !m.primary).cloned()),
        Some(name) => list.iter().find(|m| m.name == name).cloned().map(Some).ok_or_else(|| "Unknown monitor".to_string()),
    }
}

fn screenshot(params: &Value, monitors: &Monitors, services: &dyn DesktopServices) -> Result<Value, String> {
    let output = match params.get("output") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.as_str()),
        Some(_) => return Err("Invalid output".into()),
    };
    let region = params.get("region").and_then(Value::as_bool).unwrap_or(false);
    let tmp = crate::config::runtime_dir().join(format!("shot-{}.png", std::process::id()));
    let _ = std::fs::create_dir_all(tmp.parent().unwrap());
    let png = if region {
        services.screenshot_region(&tmp)?
    } else {
        let target = resolve_output(output, &services.monitors(monitors)?)?;
        services.screenshot(target.as_ref(), &tmp)?
    };
    if png.is_empty() {
        return Err("Capture returned an empty image".into());
    }
    if png.len() > MAX_PNG_BYTES {
        return Err("Capture too large".into());
    }
    Ok(json!({ "png_base64": base64::engine::general_purpose::STANDARD.encode(png) }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::link::ToUi;
    use std::path::Path;

    /// Two monitors; the "screenshot" is the name of the monitor it was asked for.
    struct Fake;

    impl DesktopServices for Fake {
        fn name(&self) -> &'static str {
            "fake"
        }
        fn start_cursor(&self, _: async_channel::Sender<ToUi>) -> Option<&'static str> {
            None
        }
        fn monitors(&self, _: &Monitors) -> Result<Vec<Monitor>, String> {
            let mon = |name: &str, primary| Monitor { name: name.into(), primary, width: 100, height: 100, ..Default::default() };
            Ok(vec![mon("DP-1", true), mon("HDMI-A-1", false)])
        }
        fn screenshot(&self, target: Option<&Monitor>, _: &Path) -> Result<Vec<u8>, String> {
            Ok(target.map(|m| m.name.clone().into_bytes()).unwrap_or_default())
        }
    }

    /// Needs a live desktop session: `cargo test -- --ignored screenshot_live`.
    #[test]
    #[ignore]
    fn screenshot_live() {
        let m: Monitors = Default::default();
        let v = perform("screenshot", &json!({}), &m, crate::platform::Backend::detect().services.as_ref()).expect("capture");
        assert!(v["png_base64"].as_str().unwrap().len() > 1000);
    }

    #[test]
    fn window_ids_are_restricted_before_reaching_a_command() {
        assert!(valid_window_id("0x5000002") && valid_window_id("42"));
        for bad in ["", "0x1; rm", "a b", "--help", "0x1\n", "../x"] {
            assert!(!valid_window_id(bad), "{bad:?}");
        }
        let m: Monitors = Default::default();
        assert!(perform("focus_window", &json!({ "id": "x;y" }), &m, &Fake).is_err());
        assert!(perform("list_windows", &json!({}), &m, &Fake).is_err(), "default services do not list windows");
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
        let s = Fake;
        assert!(perform("rm_rf", &json!({}), &m, &s).is_err());
        assert!(perform("launch_app", &json!({ "name": "a;b" }), &m, &s).is_err());
        assert!(perform("screenshot", &json!({ "output": 5 }), &m, &s).is_err());
    }

    #[test]
    fn screenshot_targets_the_requested_monitor() {
        let m: Monitors = Default::default();
        let v = perform("screenshot", &json!({ "output": "secondary" }), &m, &Fake).unwrap();
        assert_eq!(v["png_base64"], base64::engine::general_purpose::STANDARD.encode("HDMI-A-1"));
        assert!(perform("screenshot", &json!({ "output": "nope" }), &m, &Fake).is_err());
        let list = perform("list_monitors", &json!({}), &m, &Fake).unwrap();
        assert_eq!(list["monitors"][1]["id"], 2);
        assert_eq!(list["monitors"][0]["focused"], true);
    }
}
