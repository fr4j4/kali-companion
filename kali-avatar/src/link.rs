//! WebSocket link to kali-core.
//!
//! One blocking thread owns the connection: it authenticates, registers the native capabilities,
//! joins in presence mode (no history replay), forwards core events to the UI and answers
//! `desktop_action` requests on worker threads. Reconnects with jittered backoff and detects dead
//! sockets with ping/pong.

use crate::actions::{self, Monitors, CAPABILITIES};
use crate::config::Config;
use crate::platform::DesktopServices;
use serde_json::{json, Value};
use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{HandshakeError, Message, WebSocket};

/// Messages for the UI thread.
pub enum ToUi {
    /// Raw JSON text of a core event.
    Presence(String),
    Connected(bool),
    /// Global pointer position in compositor coordinates.
    Cursor(i32, i32),
    /// Window position (compositor coordinates) after the window manager moved it (X11).
    Moved(i32, i32),
    /// A consent card to show; the answer goes back through the sender.
    Consent(crate::perms::ConsentRequest, std::sync::mpsc::Sender<crate::perms::Decision>),
    /// A screen capture was just taken: thumbnail as a PNG data URL (`None` when turned off).
    Captured(Option<String>),
    Command(Cmd),
}

pub enum Cmd {
    ToggleAvatar,
    OpenShell(&'static str),
    /// Revoke every permission now.
    Panic,
    Quit,
}

pub type SharedConfig = Arc<Mutex<Config>>;

const HEARTBEAT: Duration = Duration::from_secs(25);
const PONG_TIMEOUT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(500);

pub fn spawn(config: SharedConfig, monitors: Monitors, services: Arc<dyn DesktopServices>, ui: async_channel::Sender<ToUi>) {
    thread::Builder::new()
        .name("kali-link".into())
        .spawn(move || run(config, monitors, services, ui))
        .expect("spawn link thread");
}

fn run(config: SharedConfig, monitors: Monitors, services: Arc<dyn DesktopServices>, ui: async_channel::Sender<ToUi>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        let cfg = config.lock().map(|c| c.clone()).unwrap_or_default();
        let Some(url) = cfg.ws_url() else {
            thread::sleep(Duration::from_secs(2));
            continue;
        };
        let started = Instant::now();
        let outcome = session(&url, &cfg, &config, &monitors, &services, &ui);
        // Task grants do not survive the link to the core.
        if let Some(guard) = crate::perms::global() {
            guard.session_ended();
        }
        let _ = ui.send_blocking(ToUi::Connected(false));
        if let Err(reason) = &outcome {
            if std::env::var_os("KALI_AVATAR_DEBUG").is_some() {
                eprintln!("[kali-avatar] link: {reason}");
            }
        }
        // A session that stayed up for a while was healthy: restart the backoff.
        if started.elapsed() > Duration::from_secs(30) {
            backoff = Duration::from_secs(1);
        }
        if matches!(outcome, Err(LinkError::AuthRequired)) {
            // Wait for the user to change the token instead of hammering the server.
            wait_for_config_change(&config, &cfg);
            continue;
        }
        thread::sleep(jitter(backoff));
        backoff = (backoff * 2).min(Duration::from_secs(10));
    }
}

fn wait_for_config_change(config: &SharedConfig, old: &Config) {
    loop {
        thread::sleep(Duration::from_secs(2));
        if config.lock().map(|c| c.link_key() != old.link_key()).unwrap_or(false) {
            return;
        }
    }
}

/// +/-25% jitter without pulling in a RNG crate.
fn jitter(base: Duration) -> Duration {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let factor = 0.75 + (nanos % 1000) as f64 / 2000.0;
    base.mul_f64(factor)
}

#[derive(Debug)]
enum LinkError {
    Io(String),
    AuthRequired,
    ConfigChanged,
    Timeout,
}

impl std::fmt::Display for LinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LinkError::Io(e) => write!(f, "{e}"),
            LinkError::AuthRequired => write!(f, "authentication required"),
            LinkError::ConfigChanged => write!(f, "configuration changed"),
            LinkError::Timeout => write!(f, "heartbeat timeout"),
        }
    }
}

fn io_err<E: std::fmt::Display>(e: E) -> LinkError {
    LinkError::Io(e.to_string())
}

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

fn connect(url: &str) -> Result<Socket, LinkError> {
    // Idempotent: Err only means a provider is already installed.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let request = url.into_client_request().map_err(io_err)?;
    let uri = request.uri().clone();
    let host = uri.host().ok_or_else(|| io_err("missing host"))?.to_string();
    let port = uri.port_u16().unwrap_or(if uri.scheme_str() == Some("wss") { 443 } else { 80 });
    let addr = (host.as_str(), port).to_socket_addrs().map_err(io_err)?.next().ok_or_else(|| io_err("no address"))?;
    let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(8)).map_err(io_err)?;
    let _ = stream.set_nodelay(true);
    stream.set_read_timeout(Some(Duration::from_secs(10))).map_err(io_err)?;
    stream.set_write_timeout(Some(Duration::from_secs(10))).map_err(io_err)?;
    let mut socket = match tungstenite::client_tls(request, stream) {
        Ok((socket, _)) => socket,
        Err(HandshakeError::Failure(e)) => return Err(io_err(e)),
        Err(HandshakeError::Interrupted(mut mid)) => loop {
            match mid.handshake() {
                Ok((socket, _)) => break socket,
                Err(HandshakeError::Interrupted(next)) => mid = next,
                Err(HandshakeError::Failure(e)) => return Err(io_err(e)),
            }
        },
    };
    set_poll_timeout(&mut socket);
    Ok(socket)
}

fn set_poll_timeout(socket: &mut Socket) {
    let tcp = match socket.get_mut() {
        MaybeTlsStream::Plain(s) => Some(&*s),
        MaybeTlsStream::Rustls(s) => Some(&s.sock),
        _ => None,
    };
    if let Some(tcp) = tcp {
        let _ = tcp.set_read_timeout(Some(POLL));
    }
}

fn send_json(socket: &mut Socket, value: Value) -> Result<(), LinkError> {
    socket.send(Message::text(value.to_string())).map_err(io_err)
}

fn session(url: &str, cfg: &Config, shared: &SharedConfig, monitors: &Monitors, services: &Arc<dyn DesktopServices>, ui: &async_channel::Sender<ToUi>) -> Result<(), LinkError> {
    let mut socket = connect(url)?;
    let key = cfg.link_key();

    // Same handshake order as kali-web: auth first, then capabilities, then hello.
    send_json(&mut socket, json!({ "event": "auth", "token": cfg.token }))?;
    if !cfg.capability_token.is_empty() {
        send_json(
            &mut socket,
            json!({
                "event": "desktop_register", "token": cfg.capability_token,
                "capabilities": CAPABILITIES, "platform": std::env::consts::OS,
            }),
        )?;
    }
    send_json(&mut socket, json!({ "event": "hello", "mode": "presence", "client": "kali-avatar", "version": env!("CARGO_PKG_VERSION") }))?;

    let (reply_tx, reply_rx): (Sender<String>, Receiver<String>) = mpsc::channel();
    let mut last_ping = Instant::now();
    let mut pong_deadline: Option<Instant> = None;

    loop {
        if shared.lock().map(|c| c.link_key() != key).unwrap_or(false) {
            let _ = socket.close(None);
            return Err(LinkError::ConfigChanged);
        }
        while let Ok(reply) = reply_rx.try_recv() {
            socket.send(Message::text(reply)).map_err(io_err)?;
        }
        if pong_deadline.map_or(false, |d| Instant::now() > d) {
            return Err(LinkError::Timeout);
        }
        if last_ping.elapsed() > HEARTBEAT {
            send_json(&mut socket, json!({ "event": "ping", "t": 0 }))?;
            last_ping = Instant::now();
            pong_deadline = Some(Instant::now() + PONG_TIMEOUT);
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let Ok(event) = serde_json::from_str::<Value>(&text) else { continue };
                match event["event"].as_str().unwrap_or_default() {
                    "pong" => pong_deadline = None,
                    "auth_required" => return Err(LinkError::AuthRequired),
                    "desktop_action" => spawn_action(event, monitors.clone(), services.clone(), reply_tx.clone(), ui.clone(), shared.clone()),
                    "ready" => {
                        let _ = ui.send_blocking(ToUi::Connected(true));
                        let _ = ui.send_blocking(ToUi::Presence(text.to_string()));
                    }
                    _ => {
                        let _ = ui.send_blocking(ToUi::Presence(text.to_string()));
                    }
                }
            }
            Ok(Message::Close(_)) => return Err(io_err("closed by server")),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => return Err(io_err(e)),
        }
    }
}

fn spawn_action(event: Value, monitors: Monitors, services: Arc<dyn DesktopServices>, reply: Sender<String>, ui: async_channel::Sender<ToUi>, shared: SharedConfig) {
    thread::spawn(move || {
        let id = event["id"].clone();
        let action = event["action"].as_str().unwrap_or_default().to_string();
        let params = event.get("params").cloned().unwrap_or(Value::Null);
        let reason = event["reason"].as_str().unwrap_or_default().to_string();
        let result = authorized_perform(&action, &params, &reason, &monitors, services.as_ref());
        if action == "screenshot" {
            if let Ok(value) = &result {
                announce_capture(value, &shared, &ui);
            }
        }
        let frame = match result {
            Ok(result) => json!({ "event": "desktop_action_result", "id": id, "ok": true, "result": result }),
            Err(error) => json!({ "event": "desktop_action_result", "id": id, "ok": false, "error": error }),
        };
        let _ = reply.send(frame.to_string());
    });
}

/// Run an action only after the local permission layer allows it, whatever the core asked for.
fn authorized_perform(action: &str, params: &Value, reason: &str, monitors: &Monitors, services: &dyn DesktopServices) -> Result<Value, String> {
    let Some(guard) = crate::perms::global() else {
        return Err("Permission layer unavailable".into());
    };
    // The card names what the agent itself resolved, never a label or id the core supplied.
    let mut params = params.clone();
    if let Some(map) = params.as_object_mut() {
        map.remove("label");
    }
    if action == "launch_app" {
        let name = params["name"].as_str().ok_or("Invalid desktop entry")?;
        if name.is_empty() || name.len() > 100 {
            return Err("Invalid desktop entry".into());
        }
        let (id, label) = crate::apps::resolve_for_launch(name)?;
        params = json!({ "name": id, "label": label });
    }
    if action == "focus_window" {
        // Name the window on the card from the agent's own listing, never from the core.
        let id = params["id"].as_str().filter(|id| actions::valid_window_id(id)).ok_or("Invalid window id")?.to_string();
        let window = services.windows()?.into_iter().find(|w| w.id == id).ok_or("Unknown window")?;
        params = json!({ "id": id, "label": format!("{} ({})", window.title, window.app_id) });
    }
    let auth = guard.authorize(action, &params, reason)?;
    let outcome = actions::perform(action, &params, monitors, services);
    guard.finish(action, &params, &auth, &outcome);
    outcome
}

/// After an authorized capture: tell the avatar so it can show a thumbnail and click. Purely
/// informational; it happens after the user already said yes on the consent card.
fn announce_capture(result: &Value, shared: &SharedConfig, ui: &async_channel::Sender<ToUi>) {
    let prefs = shared.lock().map(|c| c.avatar.clone()).unwrap_or_default();
    if !prefs.capture_thumbnail && !prefs.capture_sound {
        return;
    }
    let thumb = if prefs.capture_thumbnail {
        use base64::Engine;
        result["png_base64"]
            .as_str()
            .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok())
            .and_then(|png| crate::thumb::data_url(&png, crate::thumb::MAX_SIDE))
    } else {
        None
    };
    let _ = ui.send_blocking(ToUi::Captured(thumb));
}
