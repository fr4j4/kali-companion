//! The consent card: a window owned by the agent, so neither web content nor the core can draw or
//! answer it. Deny is the default button and the focus; closing the window or letting it time out
//! also denies. Only the four buttons can answer: there is no voice or chat path into this code.

use super::{ConsentRequest, Decider, Decision};
use crate::link::ToUi;
use gtk4::prelude::*;
use gtk4::{gdk, glib, Align, Orientation};
use gtk4_layer_shell::{KeyboardMode, Layer, LayerShell};
use std::cell::Cell;
use std::rc::Rc;
use std::sync::mpsc::{self, Sender};
use std::time::Duration;

/// How long a card stays open. The core waits a little longer than this.
pub const CARD_TIMEOUT: Duration = Duration::from_secs(60);

/// Buttons ignore clicks for this long after the card appears, so a click aimed at something else
/// (the card can pop up under the pointer) cannot grant anything by accident.
const ARM_DELAY: Duration = Duration::from_millis(700);

/// Sends the request to the GTK thread and blocks the action worker for the answer. One card at a
/// time: requests queue up behind the open one instead of stacking windows.
pub struct CardDecider {
    pub ui: async_channel::Sender<ToUi>,
    pub one_at_a_time: std::sync::Mutex<()>,
}

impl CardDecider {
    pub fn new(ui: async_channel::Sender<ToUi>) -> CardDecider {
        CardDecider { ui, one_at_a_time: std::sync::Mutex::new(()) }
    }
}

impl Decider for CardDecider {
    fn ask(&self, request: &ConsentRequest) -> Decision {
        let _turn = self.one_at_a_time.lock().unwrap_or_else(|e| e.into_inner());
        let (tx, rx) = mpsc::channel();
        if self.ui.send_blocking(ToUi::Consent(request.clone(), tx)).is_err() {
            return Decision::Deny;
        }
        rx.recv_timeout(CARD_TIMEOUT + Duration::from_secs(5)).unwrap_or(Decision::Deny)
    }
}

fn what(request: &ConsentRequest) -> String {
    let target = request.target.as_deref().unwrap_or("");
    match request.action.as_str() {
        "launch_app" => format!("Abrir la aplicación «{}»", request.label.as_deref().unwrap_or(target)),
        "screenshot" if target.is_empty() => "Capturar la pantalla".to_string(),
        "screenshot" => format!("Capturar la pantalla ({target})"),
        other => format!("{other} {target}"),
    }
}

/// Build and show the card on the GTK thread; the answer goes to `reply`.
pub fn show(app: &gtk4::Application, request: ConsentRequest, reply: Sender<Decision>) {
    let window = gtk4::Window::builder().application(app).title("Kali pide permiso").resizable(false).default_width(420).build();
    let content = gtk4::Box::new(Orientation::Vertical, 10);
    for side in [content.clone()] {
        side.set_margin_top(18);
        side.set_margin_bottom(18);
        side.set_margin_start(18);
        side.set_margin_end(18);
    }
    let title = gtk4::Label::new(None);
    title.set_markup(&format!("<b>{}</b>", glib::markup_escape_text(&what(&request))));
    title.set_halign(Align::Start);
    title.set_wrap(true);
    content.append(&title);
    let class = gtk4::Label::new(Some(&format!("Tipo: {}", request.class.name())));
    class.set_halign(Align::Start);
    content.append(&class);
    if request.action == "screenshot" {
        let note = gtk4::Label::new(Some("La imagen se enviará al modelo de IA configurado para describirla."));
        note.set_halign(Align::Start);
        note.set_wrap(true);
        note.set_max_width_chars(48);
        content.append(&note);
    }
    if !request.reason.is_empty() {
        let reason = gtk4::Label::new(Some(&format!("Motivo indicado por Kali: «{}»", request.reason)));
        reason.set_halign(Align::Start);
        reason.set_wrap(true);
        reason.set_max_width_chars(48);
        content.append(&reason);
    }

    let answered = Rc::new(Cell::new(false));
    let answer = {
        let window = window.clone();
        let answered = answered.clone();
        move |decision: Decision| {
            if !answered.replace(true) {
                let _ = reply.send(decision);
                window.close();
            }
        }
    };
    let row = gtk4::Box::new(Orientation::Horizontal, 8);
    row.set_halign(Align::End);
    let button = |label: &str, decision: Decision| {
        let b = gtk4::Button::with_label(label);
        let answer = answer.clone();
        b.connect_clicked(move |_| answer(decision));
        b
    };
    let deny_stop = button("Denegar y detener", Decision::DenyAndStop);
    let deny = button("Denegar", Decision::Deny);
    let once = button("Permitir esta vez", Decision::Once);
    let once_button = once;
    row.append(&deny_stop);
    row.append(&deny);
    row.append(&once_button);
    let task_button = request.allow_task.then(|| {
        let minutes = request.task_ttl.as_secs() / 60;
        button(&format!("Permitir esta tarea ({minutes} min)"), Decision::Task)
    });
    if let Some(b) = &task_button {
        row.append(b);
    }
    content.append(&row);
    window.set_child(Some(&content));
    window.set_default_widget(Some(&deny));
    deny.grab_focus();

    // Above everything, centred, taking the keyboard only when clicked, where the compositor allows it.
    if gtk4_layer_shell::is_supported() && std::env::var_os("KALI_AVATAR_NO_LAYER").is_none() && gdk::Display::default().is_some() {
        window.init_layer_shell();
        window.set_layer(Layer::Overlay);
        window.set_keyboard_mode(KeyboardMode::OnDemand);
        window.set_namespace(Some("kali-consent"));
    }

    // Escape denies. Nothing else is bound to the keyboard.
    {
        let answer = answer.clone();
        let keys = gtk4::EventControllerKey::new();
        keys.connect_key_pressed(move |_, key, _, _| {
            if key == gdk::Key::Escape {
                answer(Decision::Deny);
                return glib::Propagation::Stop;
            }
            glib::Propagation::Proceed
        });
        window.add_controller(keys);
    }

    // Disarmed at first: only Deny works until the delay passes.
    for b in [&once_button, &deny_stop] {
        b.set_sensitive(false);
    }
    if let Some(b) = &task_button {
        b.set_sensitive(false);
    }
    {
        let armed: Vec<gtk4::Button> = [Some(once_button.clone()), Some(deny_stop.clone()), task_button.clone()].into_iter().flatten().collect();
        glib::timeout_add_local_once(ARM_DELAY, move || {
            for b in armed {
                b.set_sensitive(true);
            }
        });
    }

    // Closing the window (or the timeout) is a denial.
    {
        let answer = answer.clone();
        window.connect_close_request(move |_| {
            answer(Decision::Deny);
            glib::Propagation::Proceed
        });
    }
    glib::timeout_add_local_once(CARD_TIMEOUT, move || answer(Decision::Deny));
    window.present();
}
