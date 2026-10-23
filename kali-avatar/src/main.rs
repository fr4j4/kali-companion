//! kali-avatar: resident native desktop agent for Kali.
//!
//! Owns the floating avatar (layer-shell / regular window), the tray icon and the native desktop
//! actions, and talks to kali-core over a single presence-mode WebSocket. The heavy UI
//! (kali-shell / Electron) is started on demand.

mod actions;
mod apps;
mod ask;
mod config;
mod core_consent;
mod link;
mod perms;
mod platform;
mod suggestion;
mod thumb;
mod tray;
mod ui;

use gtk4::prelude::*;
use std::sync::{Arc, Mutex};

/// Kept for the shutdown hook, which runs outside the activate closure.
static SERVICES: std::sync::OnceLock<Arc<dyn platform::DesktopServices>> = std::sync::OnceLock::new();

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

/// `--panic`: ask the running agent (SIGUSR1) to revoke every permission.
fn panic_running() -> glib_exit::ExitCode {
    let pid = std::fs::read_to_string(pid_file()).ok().and_then(|s| s.trim().parse::<u32>().ok());
    match pid.map(|p| std::process::Command::new("kill").args(["-USR1", &p.to_string()]).status()) {
        Some(Ok(status)) if status.success() => {
            println!("permissions revoked");
            glib_exit::ExitCode::SUCCESS
        }
        _ => {
            eprintln!("kali-avatar is not running");
            glib_exit::ExitCode::FAILURE
        }
    }
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

    if let Some(mode) = ask::requested(&std::env::args().collect::<Vec<_>>()) {
        return glib_exit::ExitCode::from(ask::request(mode));
    }
    if std::env::args().any(|a| a == "--panic") {
        return panic_running();
    }
    if std::env::args().any(|a| a == "--doctor") {
        println!("{}", platform::caps::report());
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
        let backend = platform::Backend::detect();
        let decider: Arc<dyn perms::Decider> = Arc::new(perms::card::CardDecider::new(tx.clone()));
        perms::install_decider(decider.clone());
        perms::install(Arc::new(perms::Guard::new(
            decider,
            perms::audit::Audit::new(perms::audit::default_path()),
            perms::Policy { launch_allowlist: initial.permissions.launch_allowlist.clone() },
        )));
        let _ = SERVICES.set(backend.services.clone());

        ask::serve(tx.clone());
        link::spawn(shared.clone(), monitors.clone(), backend.services.clone(), tx.clone());
        // The tray needs a session bus; without one (minimal sessions, containers) run without it.
        if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some() || std::env::var_os("XDG_RUNTIME_DIR").is_some_and(|d| std::path::Path::new(&d).join("bus").exists()) {
            ksni::TrayService::new(tray::KaliTray { ui: tx.clone(), avatar_visible: initial.avatar.visible }).spawn();
        } else {
            eprintln!("[kali-avatar] no D-Bus session bus: tray disabled");
        }
        // Pointer source for eye tracking over other windows (compositor-specific, see platform/).
        if let Some(source) = backend.services.start_cursor(tx.clone()) {
            if platform::debug() {
                eprintln!("[kali-avatar] cursor source: {source}");
            }
        }
        ui::build(app, initial, shared, monitors, rx, tx, backend);
    });
    app.connect_shutdown(|_| {
        if let Some(services) = SERVICES.get() {
            services.stop();
        }
        let _ = std::fs::remove_file(pid_file());
        let _ = std::fs::remove_file(ask::socket_path());
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
