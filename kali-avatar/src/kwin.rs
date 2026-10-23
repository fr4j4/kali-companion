//! Cursor position on KDE Plasma Wayland.
//!
//! KWin does not give clients the global pointer position, but its scripting API does
//! (`workspace.cursorPos`). We register a tiny D-Bus service and load a KWin script that reports
//! the cursor to it. Best effort: failures are logged (with `KALI_AVATAR_DEBUG=1`) and the avatar
//! simply keeps its in-window tracking.

use crate::cursor::debug;
use crate::link::ToUi;
use gtk4::gio::{self, prelude::*};
use gtk4::glib;

const NAME: &str = "com.kalicompanion.Avatar";
const PATH: &str = "/com/kalicompanion/Avatar";
const SCRIPT_NAME: &str = "kali-avatar-cursor";

const XML: &str = r#"<node>
  <interface name="com.kalicompanion.Avatar">
    <method name="Cursor"><arg type="s" name="xy" direction="in"/></method>
  </interface>
</node>"#;

const SCRIPT: &str = r#"
var last = "";
function report() {
    var p = workspace.cursorPos;
    var s = Math.round(p.x) + "," + Math.round(p.y);
    if (s !== last) {
        last = s;
        callDBus("com.kalicompanion.Avatar", "/com/kalicompanion/Avatar", "com.kalicompanion.Avatar", "Cursor", s);
    }
}
if (typeof QTimer !== "undefined") {
    var timer = new QTimer();
    timer.interval = 33;
    timer.timeout.connect(report);
    timer.start();
} else {
    print("kali-avatar: QTimer unavailable in this KWin; cursor following disabled");
}
"#;

pub fn is_kde_wayland() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP").map(|d| d.to_lowercase().contains("kde")).unwrap_or(false)
        && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

pub fn parse_xy(raw: &str) -> Option<(i32, i32)> {
    let (x, y) = raw.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

/// Own the D-Bus name, then load the KWin script once the bus is ours.
pub fn start(ui: async_channel::Sender<ToUi>) {
    let Ok(node) = gio::DBusNodeInfo::for_xml(XML) else { return };
    let Some(interface) = node.lookup_interface(NAME) else { return };
    gio::bus_own_name(
        gio::BusType::Session,
        NAME,
        gio::BusNameOwnerFlags::REPLACE,
        move |connection, _| {
            let ui = ui.clone();
            let registered = connection
                .register_object(PATH, &interface)
                .method_call(move |_, _, _, _, method, params, invocation| {
                    if method == "Cursor" {
                        if let Some((raw,)) = params.get::<(String,)>() {
                            if let Some((x, y)) = parse_xy(&raw) {
                                let _ = ui.try_send(ToUi::Cursor(x, y));
                            }
                        }
                    }
                    invocation.return_value(None);
                })
                .build();
            if let Err(e) = registered {
                eprintln!("[kali-avatar] kwin: could not register D-Bus object: {e}");
            }
        },
        |connection, _| load_script(&connection),
        |_, _| {
            if debug() {
                eprintln!("[kali-avatar] kwin: lost the D-Bus name");
            }
        },
    );
}

fn call(connection: &gio::DBusConnection, path: &str, iface: &str, method: &str, args: Option<&glib::Variant>) -> Result<glib::Variant, glib::Error> {
    connection.call_sync(Some("org.kde.KWin"), path, iface, method, args, None, gio::DBusCallFlags::NONE, 2000, None::<&gio::Cancellable>)
}

fn load_script(connection: &gio::DBusConnection) {
    let file = crate::config::runtime_dir().join("kali-avatar-cursor.js");
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(&file, SCRIPT) {
        eprintln!("[kali-avatar] kwin: could not write script: {e}");
        return;
    }
    let _ = call(connection, "/Scripting", "org.kde.kwin.Scripting", "unloadScript", Some(&(SCRIPT_NAME,).to_variant()));
    let args = (file.to_string_lossy().to_string(), SCRIPT_NAME).to_variant();
    let id = match call(connection, "/Scripting", "org.kde.kwin.Scripting", "loadScript", Some(&args)) {
        Ok(reply) => reply.get::<(i32,)>().map(|t| t.0).unwrap_or(-1),
        Err(e) => {
            eprintln!("[kali-avatar] kwin: loadScript failed (cursor following disabled): {e}");
            return;
        }
    };
    // Plasma 6 exposes the script at /Scripting/Script<id>, Plasma 5 at /<id>.
    let started = [format!("/Scripting/Script{id}"), format!("/{id}")]
        .iter()
        .any(|path| call(connection, path, "org.kde.kwin.Script", "run", None).is_ok());
    if debug() {
        eprintln!("[kali-avatar] kwin: cursor script id={id} started={started}");
    }
}

pub fn stop() {
    if let Ok(connection) = gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>) {
        let _ = call(&connection, "/Scripting", "org.kde.kwin.Scripting", "unloadScript", Some(&(SCRIPT_NAME,).to_variant()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cursor_report() {
        assert_eq!(parse_xy("1920,1080"), Some((1920, 1080)));
        assert_eq!(parse_xy("-5, 7"), Some((-5, 7)));
        assert_eq!(parse_xy("x"), None);
    }
}
