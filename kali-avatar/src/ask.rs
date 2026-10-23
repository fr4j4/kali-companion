//! `kali-avatar --ask-region` / `--ask-screen`: the user's own shortcut to show Kali something.
//!
//! Bind either command to a global shortcut in the compositor. The running agent selects the
//! region (or grabs the main monitor), shows a preview, and only sends the image after the user
//! presses "Enviar a Kali". Discarding is the default (focus, Escape, closing, timeout), and no
//! word spoken or typed to Kali can trigger or confirm any step.

use crate::config::runtime_dir;
use crate::link::{self, ToUi};
use gtk4::prelude::*;
use gtk4::{gdk, glib, Align, Orientation};
use gtk4_layer_shell::{KeyboardMode, Layer, LayerShell};
use serde_json::json;
use std::cell::Cell;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::ExitCode;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const MAX_PNG_BYTES: usize = 8 * 1024 * 1024;
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(120);
const ARM_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Mode {
    Region,
    Screen,
}

impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Region => "region",
            Mode::Screen => "screen",
        }
    }

    fn from_flag(flag: &str) -> Option<Mode> {
        match flag {
            "--ask-region" | "ask-region" => Some(Mode::Region),
            "--ask-screen" | "ask-screen" => Some(Mode::Screen),
            _ => None,
        }
    }
}

pub fn socket_path() -> PathBuf {
    runtime_dir().join("avatar.sock")
}

/// The mode requested on the command line, if any.
pub fn requested(args: &[String]) -> Option<Mode> {
    args.iter().find_map(|a| Mode::from_flag(a))
}

/// CLI side: ask the running agent to start the flow.
pub fn request(mode: Mode) -> ExitCode {
    let mut stream = match UnixStream::connect(socket_path()) {
        Ok(s) => s,
        Err(_) => {
            eprintln!("kali-avatar is not running");
            return ExitCode::FAILURE;
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    if writeln!(stream, "ask-{}", mode.name()).is_err() {
        return ExitCode::FAILURE;
    }
    let mut reply = String::new();
    let _ = BufReader::new(stream).read_line(&mut reply);
    if reply.trim() == "ok" {
        ExitCode::SUCCESS
    } else {
        eprintln!("{}", reply.trim());
        ExitCode::FAILURE
    }
}

/// Agent side: listen for requests. The socket lives in the user's runtime dir and is 0600.
pub fn serve(ui: async_channel::Sender<ToUi>) {
    let path = socket_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[kali-avatar] shortcut socket unavailable: {e}");
            return;
        }
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    std::thread::Builder::new()
        .name("kali-ask".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                handle(stream, &ui);
            }
        })
        .ok();
}

fn handle(stream: UnixStream, ui: &async_channel::Sender<ToUi>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut line = String::new();
    BufReader::new(&stream).take_line(&mut line);
    let reply = match Mode::from_flag(line.trim()) {
        None => "error: unknown command".to_string(),
        Some(_) if !link::is_connected() => "error: kali-avatar is not connected to the core".to_string(),
        Some(mode) => {
            if BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                "error: a capture is already in progress".to_string()
            } else {
                let _ = ui.send_blocking(ToUi::Ask(mode));
                "ok".to_string()
            }
        }
    };
    let mut stream = stream;
    let _ = writeln!(stream, "{reply}");
}

/// Reads one short line without allowing a peer to make us buffer more than a few bytes.
trait TakeLine {
    fn take_line(self, out: &mut String);
}

impl<R: std::io::Read> TakeLine for BufReader<R> {
    fn take_line(self, out: &mut String) {
        let mut limited = self.take(64);
        let mut buf = Vec::new();
        let _ = limited.read_until(b'\n', &mut buf);
        *out = String::from_utf8_lossy(&buf).to_string();
    }
}

/// One flow at a time: the selector, then the preview.
pub static BUSY: AtomicBool = AtomicBool::new(false);

/// Worker: grab the image the user asked for. Region selection is the user dragging a rectangle.
pub fn capture(mode: Mode, services: &dyn crate::platform::DesktopServices, monitors: &crate::actions::Monitors) -> Result<Vec<u8>, String> {
    let tmp = runtime_dir().join(format!("ask-{}.png", std::process::id()));
    let _ = std::fs::create_dir_all(tmp.parent().unwrap());
    let png = match mode {
        Mode::Region => services.screenshot_region(&tmp)?,
        Mode::Screen => {
            let list = services.monitors(monitors)?;
            let target = list.iter().find(|m| m.primary).or(list.first()).cloned();
            services.screenshot(target.as_ref(), &tmp)?
        }
    };
    if png.is_empty() {
        return Err("La captura salió vacía".into());
    }
    if png.len() > MAX_PNG_BYTES {
        return Err("La captura es demasiado grande".into());
    }
    Ok(png)
}

/// The frame that hands an approved capture to the core.
pub fn user_capture_frame(mode: Mode, png: &[u8]) -> serde_json::Value {
    use base64::Engine;
    json!({ "event": "user_capture", "mode": mode.name(), "png_base64": base64::engine::general_purpose::STANDARD.encode(png) })
}

/// Preview of what is about to leave this computer. Send is the only way it goes anywhere.
pub fn show_preview(app: &gtk4::Application, png: Vec<u8>, mode: Mode) {
    let window = gtk4::Window::builder().application(app).title("Enviar captura a Kali").resizable(false).build();
    let content = gtk4::Box::new(Orientation::Vertical, 10);
    for m in [&content] {
        m.set_margin_top(14);
        m.set_margin_bottom(14);
        m.set_margin_start(14);
        m.set_margin_end(14);
    }
    let title = gtk4::Label::new(Some("Esto se enviará al modelo de IA configurado para describirlo y responderte."));
    title.set_wrap(true);
    title.set_max_width_chars(48);
    title.set_halign(Align::Start);
    content.append(&title);
    let pixbuf = {
        let loader = gtk4::gdk_pixbuf::PixbufLoader::new();
        loader.write(&png).ok().and_then(|_| loader.close().ok()).and_then(|_| loader.pixbuf())
    };
    if let Some(texture) = pixbuf.map(|p| gdk::Texture::for_pixbuf(&p)) {
        let picture = gtk4::Picture::for_paintable(&texture);
        picture.set_can_shrink(true);
        picture.set_size_request(480, (480.0_f64 * texture.height() as f64 / texture.width().max(1) as f64).clamp(80.0, 360.0) as i32);
        content.append(&picture);
    }
    let finished = Rc::new(Cell::new(false));
    let end = {
        let window = window.clone();
        let finished = finished.clone();
        move |send: bool, png: &[u8]| {
            if finished.replace(true) {
                return;
            }
            if let Some(guard) = crate::perms::global() {
                guard.record_user_capture(mode.name(), if send { "send" } else { "discard" });
            }
            if send && !link::send_frame(user_capture_frame(mode, png)) {
                eprintln!("[kali-avatar] capture not sent: no link to the core");
            }
            BUSY.store(false, Ordering::SeqCst);
            window.close();
        }
    };
    let png = Rc::new(png);
    let row = gtk4::Box::new(Orientation::Horizontal, 8);
    row.set_halign(Align::End);
    let discard = gtk4::Button::with_label("Descartar");
    let send = gtk4::Button::with_label("Enviar a Kali");
    send.set_sensitive(false);
    {
        let (end, png) = (end.clone(), png.clone());
        discard.connect_clicked(move |_| end(false, &png));
    }
    {
        let (end, png) = (end.clone(), png.clone());
        send.connect_clicked(move |_| end(true, &png));
    }
    row.append(&discard);
    row.append(&send);
    content.append(&row);
    window.set_child(Some(&content));
    window.set_default_widget(Some(&discard));
    discard.grab_focus();

    if gtk4_layer_shell::is_supported() && std::env::var_os("KALI_AVATAR_NO_LAYER").is_none() && gdk::Display::default().is_some() {
        window.init_layer_shell();
        window.set_layer(Layer::Overlay);
        window.set_keyboard_mode(KeyboardMode::OnDemand);
        window.set_namespace(Some("kali-capture-preview"));
    }
    {
        let (end, png) = (end.clone(), png.clone());
        let keys = gtk4::EventControllerKey::new();
        keys.connect_key_pressed(move |_, key, _, _| {
            if key == gdk::Key::Escape {
                end(false, &png);
                return glib::Propagation::Stop;
            }
            glib::Propagation::Proceed
        });
        window.add_controller(keys);
    }
    glib::timeout_add_local_once(ARM_DELAY, move || send.set_sensitive(true));
    {
        let (end, png) = (end.clone(), png.clone());
        window.connect_close_request(move |_| {
            end(false, &png);
            glib::Propagation::Proceed
        });
    }
    {
        let (end, png) = (end, png);
        glib::timeout_add_local_once(PREVIEW_TIMEOUT, move || end(false, &png));
    }
    window.present();
}

/// A short message when the flow cannot continue (cancelled selection, unsupported desktop).
pub fn show_notice(app: &gtk4::Application, text: &str) {
    let window = gtk4::Window::builder().application(app).title("Kali").resizable(false).decorated(false).build();
    let label = gtk4::Label::new(Some(text));
    label.set_wrap(true);
    label.set_max_width_chars(44);
    for set in [gtk4::Widget::set_margin_top, gtk4::Widget::set_margin_bottom, gtk4::Widget::set_margin_start, gtk4::Widget::set_margin_end] {
        set(label.upcast_ref(), 14);
    }
    window.set_child(Some(&label));
    if gtk4_layer_shell::is_supported() && std::env::var_os("KALI_AVATAR_NO_LAYER").is_none() && gdk::Display::default().is_some() {
        window.init_layer_shell();
        window.set_layer(Layer::Top);
        window.set_keyboard_mode(KeyboardMode::None);
        window.set_namespace(Some("kali-notice"));
    }
    window.present();
    let w = window.clone();
    glib::timeout_add_local_once(Duration::from_secs(5), move || w.close());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_map_to_modes() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(requested(&args(&["kali-avatar", "--ask-region"])), Some(Mode::Region));
        assert_eq!(requested(&args(&["kali-avatar", "--ask-screen"])), Some(Mode::Screen));
        assert_eq!(requested(&args(&["kali-avatar", "--panic"])), None);
        assert_eq!(Mode::from_flag("ask-region"), Some(Mode::Region));
        assert_eq!(Mode::from_flag("ask-everything"), None);
    }

    #[test]
    fn the_frame_carries_the_image_and_the_mode_only() {
        let frame = user_capture_frame(Mode::Region, b"png");
        assert_eq!(frame["event"], "user_capture");
        assert_eq!(frame["mode"], "region");
        assert_eq!(frame["png_base64"], "cG5n");
        assert_eq!(frame.as_object().unwrap().len(), 3);
    }

    #[test]
    fn socket_commands_are_read_with_a_size_limit() {
        let mut out = String::new();
        BufReader::new(std::io::Cursor::new(format!("ask-screen\n{}", "x".repeat(1000)))).take_line(&mut out);
        assert_eq!(out.trim(), "ask-screen");
        BufReader::new(std::io::Cursor::new("y".repeat(1000))).take_line(&mut out);
        assert_eq!(out.len(), 64);
    }
}
