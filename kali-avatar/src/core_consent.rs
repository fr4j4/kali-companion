//! Consent questions from the core's own tools (shell commands, file reads...), shown as the
//! agent's card on the desktop so they appear even when no chat window is open.
//!
//! The text on the card is built here from the tool name; what the core supplies as details is
//! shown quoted and truncated. Closing, Escape and the timeout deny.

use crate::perms::{self, ActionClass, ConsentRequest, Decision};
use serde_json::{json, Value};
use std::time::Duration;

const MAX_DETAIL: usize = 400;
const KEYS: [&str; 9] = ["command", "path", "name", "url", "query", "framework", "branch", "reason", "monitor"];

/// What the card says for a tool. Unknown tools get a generic, sanitized sentence.
fn summary(tool: &str) -> String {
    match tool {
        "run_command" => "Ejecutar un comando en tu equipo".into(),
        "fs_read" => "Leer un archivo".into(),
        "fs_list" => "Listar una carpeta".into(),
        "organize_folder" => "Organizar una carpeta".into(),
        "run_tests" => "Ejecutar las pruebas de un proyecto".into(),
        "git_worktree" => "Crear un worktree de git".into(),
        "git_diff" => "Leer los cambios de git".into(),
        "web_fetch" => "Abrir una dirección web".into(),
        other => {
            let clean: String = other.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(40).collect();
            format!("Usar la herramienta «{clean}»")
        }
    }
}

fn details(params: &Value) -> String {
    let mut parts = Vec::new();
    for key in KEYS {
        if let Some(v) = params.get(key).and_then(Value::as_str).filter(|v| !v.trim().is_empty()) {
            parts.push(format!("{key}: {}", v.split_whitespace().collect::<Vec<_>>().join(" ")));
        }
    }
    parts.join(" · ").chars().take(MAX_DETAIL).collect()
}

/// The card request for a `consent_request` event with `native: true`.
pub fn request_from(event: &Value) -> Option<(String, ConsentRequest)> {
    let id = event["id"].as_str().filter(|i| !i.is_empty() && i.len() <= 64)?.to_string();
    let tool = event["tool"].as_str().filter(|t| !t.is_empty() && t.len() <= 64)?;
    Some((
        id,
        ConsentRequest {
            action: "core_tool".into(),
            class: ActionClass::Tool,
            target: Some(tool.chars().take(64).collect()),
            label: Some(summary(tool)),
            reason: details(&event["reason_params"]),
            allow_task: true,
            task_ttl: Duration::from_secs(0),
        },
    ))
}

/// The core's word for each answer. Everything but an explicit allow is a denial.
pub fn wire_decision(d: Decision) -> &'static str {
    match d {
        Decision::Once => "allow",
        Decision::Task => "allow_session",
        Decision::Deny | Decision::DenyAndStop => "deny",
    }
}

/// Ask on a worker thread and return the `consent_response` frame to send.
pub fn answer(event: &Value) -> Option<Value> {
    let (id, request) = request_from(event)?;
    let decision = match perms::decider() {
        Some(decider) => decider.ask(&request),
        None => Decision::Deny,
    };
    if let Some(guard) = perms::global() {
        guard.record_core_consent(request.target.as_deref().unwrap_or(""), wire_decision(decision));
        if decision == Decision::DenyAndStop {
            guard.panic("deny-and-stop");
        }
    }
    Some(json!({ "event": "consent_response", "id": id, "decision": wire_decision(decision) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(tool: &str) -> Value {
        json!({ "event": "consent_request", "native": true, "id": "consent_ab12", "tool": tool,
                "reason_params": { "command": "df  -h\n/", "ignored": "x" } })
    }

    #[test]
    fn builds_a_card_from_the_tool_not_from_core_text() {
        let (id, r) = request_from(&event("run_command")).unwrap();
        assert_eq!(id, "consent_ab12");
        assert_eq!(r.label.as_deref(), Some("Ejecutar un comando en tu equipo"));
        assert_eq!(r.reason, "command: df -h /");
        assert_eq!(r.class, ActionClass::Tool);
    }

    #[test]
    fn unknown_tool_names_are_sanitized() {
        let (_, r) = request_from(&event("evil«tool»\n<b>")).unwrap();
        assert_eq!(r.label.as_deref(), Some("Usar la herramienta «eviltoolb»"));
    }

    #[test]
    fn details_are_truncated_and_malformed_events_dropped() {
        let long = json!({ "id": "c", "tool": "fs_read", "reason_params": { "path": "x".repeat(1000) } });
        assert!(request_from(&long).unwrap().1.reason.chars().count() <= MAX_DETAIL);
        assert!(request_from(&json!({ "tool": "fs_read" })).is_none());
        assert!(request_from(&json!({ "id": "c" })).is_none());
    }

    #[test]
    fn only_an_explicit_allow_allows() {
        assert_eq!(wire_decision(Decision::Once), "allow");
        assert_eq!(wire_decision(Decision::Task), "allow_session");
        assert_eq!(wire_decision(Decision::Deny), "deny");
        assert_eq!(wire_decision(Decision::DenyAndStop), "deny");
    }

    #[test]
    fn without_a_card_the_answer_is_deny() {
        // No decider is installed in unit tests.
        let frame = answer(&event("run_command")).unwrap();
        assert_eq!(frame["decision"], "deny");
    }
}
