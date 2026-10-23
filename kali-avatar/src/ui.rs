//! GTK window: layer-shell surface on Wayland compositors that support it, a plain undecorated
//! window elsewhere (GNOME Wayland, X11), hosting a transparent WebView with the avatar bundle.

use crate::actions::{Monitor, Monitors};
use crate::config::{self, Config};
use crate::link::{Cmd, SharedConfig, ToUi};
use gtk4::prelude::*;
use gtk4::{gdk, gio, glib};
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use webkit6::prelude::*;
use webkit6::{UserContentManager, WebContext, WebView};

const MARGIN: i32 = 24;
const HOST: &str = "kali://app";

struct State {
    window: gtk4::ApplicationWindow,
    webview: WebView,
    config: Config,
    ready: bool,
    pending: Vec<String>,
    layer: bool,
    last_mtime: Option<std::time::SystemTime>,
}

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

pub fn launch_shell(target: &str) {
    let cmd = std::env::var("KALI_SHELL_CMD").unwrap_or_else(|_| "kali-shell".into());
    if let Err(e) = std::process::Command::new(&cmd).arg(format!("--open={target}")).spawn() {
        eprintln!("[kali-avatar] could not start {cmd}: {e}");
    }
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
            }
        })
        .collect();
    if let Ok(mut guard) = shared.lock() {
        *guard = list;
    }
}

fn corner_edges(corner: &str) -> (Edge, Edge) {
    let vertical = if corner.starts_with("top") { Edge::Top } else { Edge::Bottom };
    let horizontal = if corner.ends_with("left") { Edge::Left } else { Edge::Right };
    (vertical, horizontal)
}

fn apply_prefs(state: &State) {
    let prefs = &state.config.avatar;
    let size = prefs.size as i32;
    state.window.set_default_size(size, size + 20);
    state.window.set_size_request(size, size + 20);
    if state.layer {
        let (vertical, horizontal) = corner_edges(&prefs.corner);
        for edge in [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right] {
            state.window.set_anchor(edge, edge == vertical || edge == horizontal);
            state.window.set_margin(edge, MARGIN);
        }
        let monitor = gdk::Display::default()
            .map(|d| monitor_list(&d))
            .and_then(|list| list.into_iter().find(|m| !prefs.monitor.is_empty() && m.connector().as_deref() == Some(prefs.monitor.as_str())));
        state.window.set_monitor(monitor.as_ref());
    }
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

/// X11 has no layer-shell and GTK4 cannot move toplevels: ask the window manager through wmctrl
/// (when installed) to keep the avatar above other windows and in its corner. Best effort.
fn x11_place(prefs: &config::AvatarPrefs, monitors: &Monitors) {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() || std::env::var_os("DISPLAY").is_none() {
        return;
    }
    let target = monitors.lock().ok().and_then(|list| {
        list.iter().find(|m| !prefs.monitor.is_empty() && m.name == prefs.monitor).or(list.first()).cloned()
    });
    let size = prefs.size as i32;
    let (w, h) = (size, size + 20);
    let (x, y) = match &target {
        Some(m) => {
            let x = if prefs.corner.ends_with("left") { m.x + MARGIN } else { m.x + m.width - w - MARGIN };
            let y = if prefs.corner.starts_with("top") { m.y + MARGIN } else { m.y + m.height - h - MARGIN };
            (x, y)
        }
        None => return,
    };
    std::thread::spawn(move || {
        // The window must be mapped before the window manager accepts the request.
        std::thread::sleep(std::time::Duration::from_millis(600));
        let run = |args: &[&str]| std::process::Command::new("wmctrl").args(args).status();
        if run(&["-r", "Kali Avatar", "-b", "add,above,sticky,skip_taskbar,skip_pager"]).is_err() {
            eprintln!("[kali-avatar] wmctrl not found: install it to keep the avatar on top under X11");
            return;
        }
        let _ = run(&["-r", "Kali Avatar", "-e", &format!("0,{x},{y},{w},{h}")]);
    });
}

pub fn build(
    app: &gtk4::Application,
    initial: Config,
    shared: SharedConfig,
    monitors: Monitors,
    rx: async_channel::Receiver<ToUi>,
    tx: async_channel::Sender<ToUi>,
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
    window.set_child(Some(&webview));

    let want_layer = std::env::var_os("KALI_AVATAR_NO_LAYER").is_none();
    let layer = want_layer && gtk4_layer_shell::is_supported();
    if layer {
        window.init_layer_shell();
        window.set_layer(Layer::Top);
        window.set_namespace(Some("kali-avatar"));
        window.set_keyboard_mode(KeyboardMode::None);
    } else {
        eprintln!("[kali-avatar] layer-shell unavailable: using a regular window (compositor decides stacking/position)");
    }

    let state = Rc::new(RefCell::new(State {
        window: window.clone(),
        webview: webview.clone(),
        config: initial,
        ready: false,
        pending: Vec::new(),
        layer,
        last_mtime: Config::mtime(),
    }));
    apply_prefs(&state.borrow());
    if !layer {
        x11_place(&state.borrow().config.avatar, &monitors);
    }

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
                    apply_prefs(&st);
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
                    ToUi::Command(Cmd::OpenShell(target)) => launch_shell(target),
                    ToUi::Command(Cmd::ToggleAvatar) => {
                        let mut st = state.borrow_mut();
                        st.config.avatar.visible = !st.config.avatar.visible;
                        if let Err(e) = config::save_visible(st.config.avatar.visible) {
                            eprintln!("[kali-avatar] could not save preference: {e}");
                        }
                        st.last_mtime = Config::mtime();
                        apply_prefs(&st);
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
                        apply_prefs(&st);
                    }
                }
            }
            glib::ControlFlow::Continue
        });
    }
    let _ = tx;
    window.present();
}
