//! GTK window: layer-shell surface on Wayland compositors that support it, a plain undecorated
//! window elsewhere (GNOME Wayland, X11), hosting a transparent WebView with the avatar bundle.

use crate::config::{self, Config};
use crate::link::{Cmd, SharedConfig, ToUi};
use crate::platform::{position, Backend, DragMode, Monitor, Monitors, Surface};
use gtk4::prelude::*;
use gtk4::{gdk, gio, glib};
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use webkit6::prelude::*;
use webkit6::{UserContentManager, WebContext, WebView};

const HOST: &str = "kali://app";

struct State {
    window: gtk4::ApplicationWindow,
    webview: WebView,
    config: Config,
    ready: bool,
    pending: Vec<String>,
    layer: bool,
    surface: Rc<dyn Surface>,
    last_mtime: Option<std::time::SystemTime>,
    /// Origin and size of the monitor the avatar lives on (logical px) and the avatar position inside it.
    monitor_origin: (i32, i32),
    monitor_size: (i32, i32),
    pos: (i32, i32),
    drag: Option<Drag>,
}

/// State of an in-progress pointer drag.
struct Drag {
    last_offset: (f64, f64),
    moved: bool,
}

const DRAG_THRESHOLD: f64 = 5.0;

pub fn web_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::var_os("KALI_AVATAR_WEB") {
        candidates.push(dir.into());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin) = exe.parent() {
            candidates.push(bin.join("../share/kali-avatar/web"));
            candidates.push(bin.join("../../../kali-web/dist")); // cargo run from kali-avatar/target/debug
            candidates.push(bin.join("../../kali-web/dist"));
        }
    }
    candidates.push("/usr/share/kali-avatar/web".into());
    candidates.push("/usr/local/share/kali-avatar/web".into());
    candidates.push("../kali-web/dist".into());
    candidates.into_iter().find(|p| p.join("avatar.html").is_file()).and_then(|p| p.canonicalize().ok())
}

fn mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default() {
        "html" => "text/html",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Serve `kali://app/<path>` from the installed web bundle (never outside the root).
fn register_scheme(context: &WebContext, root: PathBuf) {
    context.register_uri_scheme("kali", move |request| {
        let path = request.path().map(|p| p.to_string()).unwrap_or_default();
        let relative = path.trim_start_matches('/');
        let relative = if relative.is_empty() { "avatar.html" } else { relative };
        let resolved = root.join(relative).canonicalize();
        match resolved {
            Ok(file) if file.starts_with(&root) && file.is_file() => match std::fs::read(&file) {
                Ok(data) => {
                    let len = data.len() as i64;
                    let stream = gio::MemoryInputStream::from_bytes(&glib::Bytes::from_owned(data));
                    request.finish(&stream, len, Some(mime(&file)));
                }
                Err(e) => request.finish_error(&mut glib::Error::new(gio::IOErrorEnum::Failed, &e.to_string())),
            },
            _ => request.finish_error(&mut glib::Error::new(gio::IOErrorEnum::NotFound, "not found")),
        }
    });
    #[allow(deprecated)]
    if let Some(security) = context.security_manager() {
        security.register_uri_scheme_as_secure("kali");
        security.register_uri_scheme_as_cors_enabled("kali");
    }
}

/// Find the UI launcher: `$KALI_SHELL_CMD`, `kali-shell` on PATH, or `~/.local/bin/kali-shell`.
fn shell_command() -> String {
    if let Ok(cmd) = std::env::var("KALI_SHELL_CMD") {
        if !cmd.is_empty() {
            return cmd;
        }
    }
    let local = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/bin/kali-shell"));
    let on_path = std::env::var_os("PATH").map_or(false, |p| std::env::split_paths(&p).any(|d| d.join("kali-shell").is_file()));
    match local {
        Some(path) if !on_path && path.is_file() => path.to_string_lossy().to_string(),
        _ => "kali-shell".into(),
    }
}

pub fn launch_shell(target: &str) {
    let cmd = shell_command();
    match std::process::Command::new(&cmd).arg(format!("--open={target}")).spawn() {
        Ok(mut child) => {
            // Reap the child without blocking the UI thread.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Err(e) => {
            let message = format!("No se pudo abrir la interfaz de Kali ({cmd}): {e}");
            eprintln!("[kali-avatar] {message}");
            let _ = std::process::Command::new("notify-send").args(["Kali", &message]).spawn();
        }
    }
}

/// Click opens the UI; dragging moves the avatar. Layer-shell surfaces cannot be moved by the
/// compositor, so the margins are updated by hand and the final spot is saved.
fn install_drag(window: &gtk4::ApplicationWindow, state: Rc<RefCell<State>>, tx: async_channel::Sender<ToUi>) {
    let gesture = gtk4::GestureDrag::new();
    gesture.set_button(1);
    {
        let state = state.clone();
        gesture.connect_drag_begin(move |_, _, _| {
            state.borrow_mut().drag = Some(Drag { last_offset: (0.0, 0.0), moved: false });
        });
    }
    {
        let state = state.clone();
        let tx = tx.clone();
        gesture.connect_drag_update(move |gesture, ox, oy| {
            let mut st = state.borrow_mut();
            let layer = st.layer;
            let Some(drag) = st.drag.as_mut() else { return };
            if !drag.moved && ox.hypot(oy) < DRAG_THRESHOLD {
                return;
            }
            if !layer {
                // Regular window: let the compositor run the move.
                if !drag.moved {
                    drag.moved = true;
                    if let (Some(toplevel), Some(device), Some((sx, sy))) =
                        (st.window.surface().and_downcast::<gdk::Toplevel>(), gesture.device(), gesture.start_point())
                    {
                        toplevel.begin_move(&device, 1, sx, sy, gesture.current_event_time());
                        st.surface.remember_moved(st.monitor_origin, tx.clone());
                    }
                }
                return;
            }
            // Incremental: the window moves under the pointer, so offsets are applied as deltas.
            let (dx, dy) = (ox - drag.last_offset.0, oy - drag.last_offset.1);
            drag.last_offset = (ox, oy);
            drag.moved = true;
            let size = st.config.avatar.size as i32;
            let max_x = (st.monitor_size.0 - size).max(0);
            let max_y = (st.monitor_size.1 - size - 20).max(0);
            st.pos = ((st.pos.0 + dx.round() as i32).clamp(0, max_x), (st.pos.1 + dy.round() as i32).clamp(0, max_y));
            st.surface.move_to(&st.window, st.pos);
        });
    }
    gesture.connect_drag_end(move |_, _, _| {
        let mut st = state.borrow_mut();
        let Some(drag) = st.drag.take() else { return };
        if !drag.moved {
            drop(st);
            launch_shell("chat");
            return;
        }
        if st.layer {
            let pos = st.pos;
            st.config.avatar.x = Some(pos.0);
            st.config.avatar.y = Some(pos.1);
            if let Err(e) = config::save_position(Some(pos)) {
                eprintln!("[kali-avatar] could not save position: {e}");
            }
            st.last_mtime = Config::mtime();
        }
    });
    window.add_controller(gesture);
}

fn monitor_list(display: &gdk::Display) -> Vec<gdk::Monitor> {
    let model = display.monitors();
    (0..model.n_items()).filter_map(|i| model.item(i).and_downcast::<gdk::Monitor>()).collect()
}

/// Refresh the monitor snapshot shared with the action worker threads.
fn refresh_monitors(display: &gdk::Display, shared: &Monitors) {
    let list: Vec<Monitor> = monitor_list(display)
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let g = m.geometry();
            let name = m.connector().map(|c| c.to_string()).unwrap_or_else(|| format!("monitor-{i}"));
            Monitor {
                description: m.model().map(|d| d.to_string()).unwrap_or_else(|| name.clone()),
                name,
                x: g.x(),
                y: g.y(),
                width: g.width(),
                height: g.height(),
                primary: i == 0,
                ..Default::default()
            }
        })
        .collect();
    if let Ok(mut guard) = shared.lock() {
        *guard = list;
    }
}

fn target_monitor(prefs: &config::AvatarPrefs) -> Option<gdk::Monitor> {
    let list = gdk::Display::default().map(|d| monitor_list(&d)).unwrap_or_default();
    list.iter().find(|m| !prefs.monitor.is_empty() && m.connector().as_deref() == Some(prefs.monitor.as_str())).cloned().or_else(|| list.into_iter().next())
}

fn apply_prefs(state: &mut State) {
    let prefs = state.config.avatar.clone();
    let size = prefs.size as i32;
    state.window.set_default_size(size, size + 20);
    state.window.set_size_request(size, size + 20);
    let monitor = target_monitor(&prefs);
    if let Some(m) = &monitor {
        let g = m.geometry();
        state.monitor_origin = (g.x(), g.y());
        state.monitor_size = (g.width(), g.height());
    }
    state.pos = position(&prefs, state.monitor_size);
    state.surface.apply(&state.window, state.pos, monitor.as_ref());
    state.window.set_visible(prefs.visible);
    let _ = state.webview.evaluate_javascript(
        &format!("window.kaliAvatar&&window.kaliAvatar.configure({{showText:{}}})", prefs.show_text),
        None,
        None,
        None::<&gio::Cancellable>,
        |_| {},
    );
}

fn push(state: &mut State, json: &str) {
    if !state.ready {
        if state.pending.len() < 64 {
            state.pending.push(json.to_string());
        }
        return;
    }
    let literal = serde_json::to_string(json).unwrap_or_else(|_| "\"\"".into());
    state.webview.evaluate_javascript(&format!("window.kaliAvatar&&window.kaliAvatar.push({literal})"), None, None, None::<&gio::Cancellable>, |_| {});
}

pub fn build(
    app: &gtk4::Application,
    initial: Config,
    shared: SharedConfig,
    monitors: Monitors,
    rx: async_channel::Receiver<ToUi>,
    tx: async_channel::Sender<ToUi>,
    backend: Backend,
) {
    let Some(root) = web_root() else {
        eprintln!("[kali-avatar] avatar.html not found; set KALI_AVATAR_WEB or build kali-web (npm run build)");
        app.quit();
        return;
    };
    let display = gdk::Display::default().expect("no display");
    refresh_monitors(&display, &monitors);
    {
        let (display, monitors) = (display.clone(), monitors.clone());
        display.clone().monitors().connect_items_changed(move |_, _, _, _| refresh_monitors(&display, &monitors));
    }

    let css = gtk4::CssProvider::new();
    #[allow(deprecated)]
    css.load_from_data("window.kali-avatar { background: transparent; }");
    gtk4::style_context_add_provider_for_display(&display, &css, gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION);

    let context = WebContext::new();
    register_scheme(&context, root);
    let content = UserContentManager::new();
    content.register_script_message_handler("kali", None);
    let webview = WebView::builder().web_context(&context).user_content_manager(&content).build();
    webview.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
    if let Some(settings) = WebViewExt::settings(&webview) {
        settings.set_enable_developer_extras(std::env::var_os("KALI_AVATAR_DEBUG").is_some());
        settings.set_enable_webgl(false);
        settings.set_enable_media_stream(false);
        settings.set_enable_page_cache(false);
        settings.set_enable_write_console_messages_to_stdout(std::env::var_os("KALI_AVATAR_DEBUG").is_some());
    }

    let window = gtk4::ApplicationWindow::builder().application(app).title("Kali Avatar").decorated(false).resizable(false).build();
    window.add_css_class("kali-avatar");
    // The page is display-only: the window itself handles click (open the UI) and drag (move).
    webview.set_can_target(false);
    webview.set_focusable(false);
    window.set_child(Some(&webview));

    let surface = backend.surface.clone();
    surface.init(&window);
    let layer = surface.drag_mode() == DragMode::Margins;

    let state = Rc::new(RefCell::new(State {
        window: window.clone(),
        webview: webview.clone(),
        config: initial,
        ready: false,
        pending: Vec::new(),
        layer,
        surface: surface.clone(),
        last_mtime: Config::mtime(),
        monitor_origin: (0, 0),
        monitor_size: (1920, 1080),
        pos: (0, 0),
        drag: None,
    }));
    apply_prefs(&mut state.borrow_mut());
    surface.place_initial(&state.borrow().config.avatar, &monitors);

    // Messages from the page: "ready" flushes the queue, "open" starts kali-shell.
    {
        let state = state.clone();
        content.connect_script_message_received(Some("kali"), move |_, value| {
            let Ok(message) = serde_json::from_str::<serde_json::Value>(&value.to_json(0).map(|s| s.to_string()).unwrap_or_default()) else { return };
            if std::env::var_os("KALI_AVATAR_DEBUG").is_some() {
                eprintln!("[kali-avatar] page message: {message}");
            }
            match message["type"].as_str() {
                Some("ready") => {
                    let mut st = state.borrow_mut();
                    st.ready = true;
                    let queued: Vec<String> = st.pending.drain(..).collect();
                    for item in queued {
                        push(&mut st, &item);
                    }
                    apply_prefs(&mut st);
                }
                Some("open") => launch_shell(match message["target"].as_str() {
                    Some("artifacts") => "artifacts",
                    Some("settings") => "settings",
                    _ => "chat",
                }),
                _ => {}
            }
        });
    }
    install_drag(&window, state.clone(), tx.clone());
    webview.load_uri(&format!("{HOST}/avatar.html"));

    // Core events, tray commands and connection state.
    {
        let state = state.clone();
        let app = app.clone();
        glib::spawn_future_local(async move {
            while let Ok(msg) = rx.recv().await {
                match msg {
                    ToUi::Presence(json) => push(&mut state.borrow_mut(), &json),
                    ToUi::Connected(false) => push(&mut state.borrow_mut(), r#"{"event":"disconnected"}"#),
                    ToUi::Connected(true) => {}
                    ToUi::Moved(x, y) => {
                        let mut st = state.borrow_mut();
                        st.pos = (x - st.monitor_origin.0, y - st.monitor_origin.1);
                    }
                    ToUi::Cursor(x, y) => {
                        let st = state.borrow();
                        if st.ready {
                            let (cx, cy) = (x - st.monitor_origin.0 - st.pos.0, y - st.monitor_origin.1 - st.pos.1);
                            st.webview.evaluate_javascript(&format!("window.kaliAvatar&&window.kaliAvatar.cursor({cx},{cy})"), None, None, None::<&gio::Cancellable>, |_| {});
                        }
                    }
                    ToUi::Command(Cmd::OpenShell(target)) => launch_shell(target),
                    ToUi::Command(Cmd::ToggleAvatar) => {
                        let mut st = state.borrow_mut();
                        st.config.avatar.visible = !st.config.avatar.visible;
                        if let Err(e) = config::save_visible(st.config.avatar.visible) {
                            eprintln!("[kali-avatar] could not save preference: {e}");
                        }
                        st.last_mtime = Config::mtime();
                        apply_prefs(&mut st);
                    }
                    ToUi::Command(Cmd::Quit) => app.quit(),
                }
            }
        });
    }

    // kali-shell edits the shared config (tokens, avatar size/corner/visibility): poll its mtime.
    {
        let state = state.clone();
        glib::timeout_add_seconds_local(2, move || {
            let mtime = Config::mtime();
            let mut st = state.borrow_mut();
            if mtime != st.last_mtime {
                st.last_mtime = mtime;
                if let Some(next) = Config::load() {
                    if next != st.config {
                        st.config = next.clone();
                        if let Ok(mut guard) = shared.lock() {
                            *guard = next;
                        }
                        apply_prefs(&mut st);
                    }
                }
            }
            glib::ControlFlow::Continue
        });
    }
    let _ = tx;
    window.present();
}
