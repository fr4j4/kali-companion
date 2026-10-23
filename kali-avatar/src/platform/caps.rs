//! What this session can actually do, probed once and shown by `kali-avatar --doctor`. Backends
//! and the UI read these instead of guessing from the desktop name.

use super::{capture::which, Desktop, Env, Session};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Caps {
    /// Screenshot tools found for this session, in order of preference.
    pub screenshot: Vec<&'static str>,
    pub launch: bool,
    pub tray: bool,
    /// Compositor IPC used for monitors and cursor.
    pub ipc: Option<&'static str>,
}

impl Caps {
    /// `has` answers "is this program on PATH"; `bus` whether a D-Bus session bus is reachable.
    pub fn probe(env: Env, has: &dyn Fn(&str) -> bool, bus: bool) -> Caps {
        let pick = |names: &[&'static str]| names.iter().copied().filter(|n| has(n)).collect::<Vec<_>>();
        let screenshot = match (env.session, env.desktop) {
            (Session::Wayland, Desktop::Kde) => pick(&["spectacle", "grim"]),
            (Session::Wayland, Desktop::Gnome) => pick(&["grim", "gnome-screenshot"]),
            (Session::Wayland, _) => pick(&["grim"]),
            _ => pick(&["maim", "scrot"]),
        };
        let ipc = match env.desktop {
            Desktop::Hyprland if has("hyprctl") => Some("hyprctl"),
            Desktop::Sway if has("swaymsg") => Some("swaymsg"),
            _ => None,
        };
        Caps { screenshot, launch: has("gtk-launch"), tray: bus, ipc }
    }
}

fn session_bus() -> bool {
    std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some()
        || std::env::var_os("XDG_RUNTIME_DIR").is_some_and(|d| std::path::Path::new(&d).join("bus").exists())
}

/// Human-readable report for `--doctor`.
pub fn report() -> String {
    let env = Env::detect();
    let caps = Caps::probe(env, &which, session_bus());
    let mark = |ok: bool| if ok { "ok" } else { "falta" };
    let mut out = format!("Sesión: {:?}   Escritorio: {:?}\n", env.session, env.desktop);
    out += &format!(
        "Captura de pantalla: {}\n",
        if caps.screenshot.is_empty() { "falta (instala grim, spectacle, gnome-screenshot, maim o scrot según tu sesión)".to_string() } else { caps.screenshot.join(", ") }
    );
    out += &format!("Lanzar aplicaciones (gtk-launch): {}\n", mark(caps.launch));
    out += &format!("Bandeja (bus D-Bus de sesión): {}\n", mark(caps.tray));
    out += &format!("IPC del compositor: {}\n", caps.ipc.unwrap_or("ninguno"));
    out += &format!("Auditoría: {}\n", crate::perms::audit::default_path().display());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(session: Session, desktop: Desktop) -> Env {
        Env { session, desktop }
    }

    #[test]
    fn kde_prefers_spectacle_and_falls_back_to_grim() {
        let caps = Caps::probe(env(Session::Wayland, Desktop::Kde), &|n| matches!(n, "spectacle" | "grim"), true);
        assert_eq!(caps.screenshot, vec!["spectacle", "grim"]);
    }

    #[test]
    fn hyprland_uses_grim_and_hyprctl() {
        let caps = Caps::probe(env(Session::Wayland, Desktop::Hyprland), &|n| matches!(n, "grim" | "hyprctl" | "gtk-launch"), false);
        assert_eq!(caps.screenshot, vec!["grim"]);
        assert_eq!(caps.ipc, Some("hyprctl"));
        assert!(caps.launch && !caps.tray);
    }

    #[test]
    fn x11_without_tools_reports_none() {
        let caps = Caps::probe(env(Session::X11, Desktop::Other), &|_| false, false);
        assert!(caps.screenshot.is_empty() && !caps.launch && caps.ipc.is_none());
    }
}
