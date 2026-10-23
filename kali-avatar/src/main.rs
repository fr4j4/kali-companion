//! kali-avatar: resident native desktop agent for Kali.
//!
//! Owns the floating avatar (layer-shell / regular window), the tray icon and the native desktop
//! actions, and talks to kali-core over a single presence-mode WebSocket. The heavy UI
//! (kali-shell / Electron) is started on demand.

mod actions;
mod config;
mod cursor;
mod kwin;
mod link;
mod tray;
mod ui;

use gtk4::prelude::*;
use std::sync::{Arc, Mutex};

fn pid_file() -> std::path::PathBuf {
    config::runtime_dir().join("avatar.pid")
}

fn write_pid() {
    let path = pid_file();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, std::process::id().to_string());
}

fn main() -> glib_exit::ExitCode {
    if std::env::args().any(|a| a == "--version") {
        println!("kali-avatar {}", env!("CARGO_PKG_VERSION"));
        return glib_exit::ExitCode::SUCCESS;
    }
    if std::env::args().any(|a| a == "--print-web-root") {
        println!("{}", ui::web_root().map(|p| p.display().to_string()).unwrap_or_else(|| "not found".into()));
        return glib_exit::ExitCode::SUCCESS;
    }

    let app = gtk4::Application::builder().application_id("com.kalicompanion.avatar").build();
    app.connect_activate(|app| {
        if !app.windows().is_empty() {
            return;
        }
        write_pid();
        let initial = config::Config::load().unwrap_or_default();
        let shared: link::SharedConfig = Arc::new(Mutex::new(initial.clone()));
        let monitors: actions::Monitors = Default::default();
        let (tx, rx) = async_channel::unbounded();

        link::spawn(shared.clone(), monitors.clone(), tx.clone());
        // The tray needs a session bus; without one (minimal sessions, containers) run without it.
        if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some() || std::env::var_os("XDG_RUNTIME_DIR").is_some_and(|d| std::path::Path::new(&d).join("bus").exists()) {
            ksni::TrayService::new(tray::KaliTray { ui: tx.clone(), avatar_visible: initial.avatar.visible }).spawn();
        } else {
            eprintln!("[kali-avatar] no D-Bus session bus: tray disabled");
        }
        // Pointer source for eye tracking over other windows (see cursor.rs / kwin.rs).
        if kwin::is_kde_wayland() {
            kwin::start(tx.clone());
        } else if let Some(source) = cursor::spawn(tx.clone()) {
            if cursor::debug() {
                eprintln!("[kali-avatar] cursor source: {source}");
            }
        }
        ui::build(app, initial, shared, monitors, rx, tx);
    });
    app.connect_shutdown(|_| {
        if kwin::is_kde_wayland() {
            kwin::stop();
        }
        let _ = std::fs::remove_file(pid_file());
    });
    glib_exit::from(app.run())
}

/// Tiny shim so `main` can return the GTK exit status without extra dependencies.
mod glib_exit {
    pub use std::process::ExitCode;
    pub fn from(code: gtk4::glib::ExitCode) -> ExitCode {
        ExitCode::from(code.get())
    }
}
