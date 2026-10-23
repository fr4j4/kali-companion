//! The suggestion chips: Kali offers to look at the screen, the user decides.
//!
//! Drawn by the agent (a real GTK window), so a click is a click by the user and not something
//! web content or the core can fake. Choosing only tells the core which chat message to start;
//! the capture still goes through the consent card, which stays the only way to allow it.

use crate::link;
use gtk4::prelude::*;
use gtk4::{gdk, glib, Align, Orientation};
use gtk4_layer_shell::{Edge, KeyboardMode, Layer, LayerShell};
use serde_json::{json, Value};
use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

/// How long the chips stay if nobody answers. Ignoring is not a refusal and is not counted as one.
const VISIBLE: Duration = Duration::from_secs(25);
/// Clicks right after the window appears are ignored (it can pop up under the pointer).
const ARM_DELAY: Duration = Duration::from_millis(500);
const MAX_REASON: usize = 120;

#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub id: String,
    pub session_id: String,
    pub kind: String,
    pub reason: String,
}

/// Read a `suggestion` event from the core. Anything malformed is dropped.
pub fn parse(event: &Value) -> Option<Suggestion> {
    let id = event["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 40)?.to_string();
    let kind = event["kind"].as_str().filter(|k| matches!(*k, "region" | "screen"))?.to_string();
    let reason: String = event["reason"].as_str().unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_REASON).collect();
    let session_id = event["session_id"].as_str().unwrap_or_default().to_string();
    Some(Suggestion { id, session_id, kind, reason })
}

/// The frame sent to the core for a choice: `region`, `screen` or `dismiss`.
pub fn response(s: &Suggestion, choice: &str) -> Value {
    json!({ "event": "suggestion_response", "id": s.id, "session_id": s.session_id, "choice": choice })
}

pub fn show(app: &gtk4::Application, s: Suggestion) {
    let window = gtk4::Window::builder().application(app).title("Kali sugiere").resizable(false).decorated(false).build();
    let content = gtk4::Box::new(Orientation::Vertical, 8);
    content.set_margin_top(12);
    content.set_margin_bottom(12);
    content.set_margin_start(14);
    content.set_margin_end(14);
    let text = if s.reason.is_empty() { "¿Quieres mostrarme tu pantalla?".to_string() } else { format!("Kali: «{}»", s.reason) };
    let label = gtk4::Label::new(Some(&text));
    label.set_wrap(true);
    label.set_max_width_chars(44);
    label.set_halign(Align::Start);
    content.append(&label);

    let answered = Rc::new(Cell::new(false));
    let answer = {
        let window = window.clone();
        let answered = answered.clone();
        let s = s.clone();
        move |choice: &'static str| {
            if !answered.replace(true) {
                link::send_frame(response(&s, choice));
                window.close();
            }
        }
    };
    let row = gtk4::Box::new(Orientation::Horizontal, 8);
    row.set_halign(Align::End);
    let mut buttons = Vec::new();
    for (text, choice) in [("Una zona", "region"), ("Toda la pantalla", "screen"), ("Ahora no", "dismiss")] {
        let b = gtk4::Button::with_label(text);
        if choice == s.kind {
            b.add_css_class("suggested-action");
        }
        let answer = answer.clone();
        b.connect_clicked(move |_| answer(choice));
        b.set_sensitive(false);
        row.append(&b);
        buttons.push(b);
    }
    content.append(&row);
    window.set_child(Some(&content));

    if gtk4_layer_shell::is_supported() && std::env::var_os("KALI_AVATAR_NO_LAYER").is_none() && gdk::Display::default().is_some() {
        window.init_layer_shell();
        window.set_layer(Layer::Top);
        window.set_keyboard_mode(KeyboardMode::None);
        window.set_namespace(Some("kali-suggestion"));
        window.set_anchor(Edge::Bottom, true);
        window.set_margin(Edge::Bottom, 96);
    }
    glib::timeout_add_local_once(ARM_DELAY, move || {
        for b in buttons {
            b.set_sensitive(true);
        }
    });
    // Closing the window by hand dismisses; timing out just goes away.
    {
        let answer = answer.clone();
        window.connect_close_request(move |_| {
            answer("dismiss");
            glib::Propagation::Proceed
        });
    }
    {
        let window = window.clone();
        let answered = answered.clone();
        glib::timeout_add_local_once(VISIBLE, move || {
            if !answered.replace(true) {
                window.close();
            }
        });
    }
    window.present();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_event_and_trims_the_reason() {
        let e = json!({ "event": "suggestion", "id": "sug_1", "session_id": "s", "kind": "region", "reason": format!("  hola   {}", "x".repeat(300)) });
        let s = parse(&e).unwrap();
        assert_eq!((s.id.as_str(), s.kind.as_str(), s.session_id.as_str()), ("sug_1", "region", "s"));
        assert_eq!(s.reason.chars().count(), MAX_REASON);
        assert!(s.reason.starts_with("hola x"));
    }

    #[test]
    fn rejects_malformed_events() {
        assert!(parse(&json!({ "id": "a", "kind": "mouse" })).is_none());
        assert!(parse(&json!({ "kind": "screen" })).is_none());
        assert!(parse(&json!({ "id": "", "kind": "screen" })).is_none());
        assert!(parse(&json!({ "id": "x".repeat(50), "kind": "screen" })).is_none());
    }

    #[test]
    fn response_frame_carries_only_the_choice() {
        let s = Suggestion { id: "sug_1".into(), session_id: "s".into(), kind: "screen".into(), reason: String::new() };
        let r = response(&s, "dismiss");
        assert_eq!((r["event"].as_str(), r["choice"].as_str(), r["id"].as_str()), (Some("suggestion_response"), Some("dismiss"), Some("sug_1")));
    }
}
