//! Permission layer of the desktop agent. The agent, not the core, decides whether a native action
//! may run: a compromised or remote core cannot capture the screen or launch apps on its own.
//!
//! - [`ActionClass`]: what kind of power an action needs.
//! - [`grants`]: short-lived, scoped permissions the user handed out.
//! - [`audit`]: append-only, hash-chained log of every decision.
//! - [`Guard`]: ties them together and asks the user through a [`Decider`] when nothing covers the action.
//!
//! Voice and chat can never grant anything: only a [`Decider`] fed by a real click or key can.

pub mod audit;
pub mod card;
pub mod grants;

use audit::{Audit, Entry};
use grants::{Grant, Grants};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Kind of power an action needs. `Info` never asks; everything else does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[allow(dead_code)] // the control classes are enforced already; their actions arrive in later phases
pub enum ActionClass {
    Info,
    Observe,
    Launch,
    ClipboardWrite,
    ClipboardRead,
    Window,
    Input,
    /// A core tool (shell command, file read...) whose consent card the agent shows for the core.
    Tool,
    /// A shell command on this machine. Asked every single time: no task grants.
    Shell,
    /// Reading files or listing folders under the home folder.
    Files,
}

impl ActionClass {
    pub fn name(self) -> &'static str {
        match self {
            ActionClass::Info => "info",
            ActionClass::Observe => "observe",
            ActionClass::Launch => "launch",
            ActionClass::ClipboardWrite => "clipboard-write",
            ActionClass::ClipboardRead => "clipboard-read",
            ActionClass::Window => "window",
            ActionClass::Input => "input",
            ActionClass::Tool => "tool",
            ActionClass::Shell => "shell",
            ActionClass::Files => "files",
        }
    }

    /// Whether the user may hand out a time-boxed "allow this task" grant for the class.
    pub fn allows_task_grant(self) -> bool {
        !matches!(self, ActionClass::ClipboardRead | ActionClass::Shell)
    }

    /// Longest task grant for the class.
    pub fn max_ttl(self) -> Duration {
        match self {
            ActionClass::Input => Duration::from_secs(10 * 60),
            _ => Duration::from_secs(15 * 60),
        }
    }

    pub fn max_actions(self) -> u32 {
        match self {
            ActionClass::Input => 40,
            _ => 100,
        }
    }
}

/// Class of a native action. Unknown actions have none and are always rejected.
pub fn classify(action: &str) -> Option<ActionClass> {
    match action {
        "list_monitors" | "find_apps" | "system_info" => Some(ActionClass::Info),
        "run_command" => Some(ActionClass::Shell),
        "fs_read" | "fs_list" => Some(ActionClass::Files),
        "screenshot" => Some(ActionClass::Observe),
        "launch_app" => Some(ActionClass::Launch),
        "list_windows" => Some(ActionClass::Observe),
        "focus_window" => Some(ActionClass::Window),
        _ => None,
    }
}

/// What a grant is bound to: the app for `launch_app`, the monitor for `screenshot`.
pub fn target_of(action: &str, params: &Value) -> Option<String> {
    if action == "screenshot" && params.get("region").and_then(Value::as_bool) == Some(true) {
        return Some("region".into());
    }
    if action == "run_command" {
        // The card shows exactly what would run; it never becomes a grant (Shell has none).
        return params.get("command").and_then(Value::as_str).map(|c| c.trim().chars().take(300).collect());
    }
    let key = match action {
        "launch_app" => "name",
        "screenshot" => "output",
        "focus_window" => "id",
        _ => return None,
    };
    match params.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// The user's answer to a consent card.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Once,
    Task,
    Deny,
    /// Deny and revoke everything.
    DenyAndStop,
}

#[derive(Clone, Debug)]
pub struct ConsentRequest {
    pub action: String,
    pub class: ActionClass,
    pub target: Option<String>,
    /// Human-readable name of the target (the app's display name), for the card.
    pub label: Option<String>,
    /// Why the agent wants it, as stated by the core (untrusted text, shown as a quote).
    pub reason: String,
    pub allow_task: bool,
    pub task_ttl: Duration,
}

/// Shows a consent card and blocks for the answer. Implementations must default to deny, time out
/// to deny and only accept real pointer or keyboard input.
pub trait Decider: Send + Sync {
    fn ask(&self, request: &ConsentRequest) -> Decision;
}

/// Permission settings from the shared config.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Policy {
    /// Apps the user listed to launch without asking. Only `launch_app` honours it.
    pub launch_allowlist: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Authorization {
    pub grant_id: Option<String>,
    pub decided_by: &'static str,
}

/// The process-wide guard, set once at startup (the link, the tray and signal handlers share it).
const DENIAL_WINDOW: Duration = Duration::from_secs(60);
const MAX_DENIALS: usize = 3;

static GUARD: OnceLock<Arc<Guard>> = OnceLock::new();

pub fn install(guard: Arc<Guard>) {
    let _ = GUARD.set(guard);
}

static DECIDER: OnceLock<Arc<dyn Decider>> = OnceLock::new();

/// The card shown for questions the core itself asks (its own tools), sharing the one-at-a-time
/// queue with the agent's own cards.
pub fn install_decider(decider: Arc<dyn Decider>) {
    let _ = DECIDER.set(decider);
}

pub fn decider() -> Option<&'static Arc<dyn Decider>> {
    DECIDER.get()
}

pub fn global() -> Option<&'static Arc<Guard>> {
    GUARD.get()
}

pub struct Guard {
    grants: Mutex<Grants>,
    /// Recent denials, to stop an agent that keeps asking after being told no.
    denials: Mutex<Vec<Instant>>,
    audit: Audit,
    decider: Arc<dyn Decider>,
    policy: Mutex<Policy>,
    /// Bumped by [`Guard::panic`]; an answer that arrives after a panic is discarded.
    generation: AtomicU64,
    /// Number of observe/control grants and in-flight actions, for the avatar badge.
    active: AtomicU64,
}

impl Guard {
    pub fn new(decider: Arc<dyn Decider>, audit: Audit, policy: Policy) -> Guard {
        Guard {
            grants: Mutex::new(Grants::default()),
            denials: Mutex::new(Vec::new()),
            audit,
            decider,
            policy: Mutex::new(policy),
            generation: AtomicU64::new(0),
            active: AtomicU64::new(0),
        }
    }

    pub fn set_policy(&self, policy: Policy) {
        *self.policy.lock().unwrap() = policy;
    }

    /// Decide whether `action` may run. Blocks while the user answers a card.
    pub fn authorize(&self, action: &str, params: &Value, reason: &str) -> Result<Authorization, String> {
        let class = classify(action).ok_or_else(|| "Unsupported desktop action".to_string())?;
        let target = target_of(action, params);
        if class == ActionClass::Info {
            return Ok(Authorization { grant_id: None, decided_by: "info" });
        }
        let now = Instant::now();
        if self.cooling_down(now) {
            self.log(action, class, &target, None, "deny", "rate-limit", "denied");
            return Err("Too many requests were denied; wait a minute before asking again".into());
        }
        let generation = self.generation.load(Ordering::SeqCst);

        if class == ActionClass::Launch {
            let listed = target.as_deref().is_some_and(|t| self.policy.lock().unwrap().launch_allowlist.iter().any(|a| a == t));
            if listed {
                self.log(action, class, &target, None, "allow", "allowlist", "authorized");
                return Ok(Authorization { grant_id: None, decided_by: "allowlist" });
            }
        }
        if let Some(id) = self.grants.lock().unwrap().consume(class, target.as_deref(), now) {
            self.log(action, class, &target, Some(&id), "allow", "grant", "authorized");
            return Ok(Authorization { grant_id: Some(id), decided_by: "grant" });
        }

        let request = ConsentRequest {
            action: action.to_string(),
            class,
            target: target.clone(),
            label: params.get("label").and_then(Value::as_str).map(|l| l.chars().take(80).collect()),
            reason: reason.chars().take(300).collect(),
            allow_task: class.allows_task_grant(),
            task_ttl: class.max_ttl(),
        };
        let decision = self.decider.ask(&request);
        if self.generation.load(Ordering::SeqCst) != generation {
            self.log(action, class, &target, None, "deny", "panic", "denied");
            return Err("Permissions were revoked".into());
        }
        match decision {
            Decision::Once => {
                self.log(action, class, &target, None, "allow-once", "click", "authorized");
                Ok(Authorization { grant_id: None, decided_by: "click" })
            }
            Decision::Task if request.allow_task => {
                let grant = Grant::new(class, target.clone(), now, class.max_ttl(), class.max_actions());
                let id = grant.id.clone();
                self.grants.lock().unwrap().add(grant);
                self.log(action, class, &target, Some(&id), "allow-task", "click", "authorized");
                Ok(Authorization { grant_id: Some(id), decided_by: "click" })
            }
            Decision::Task | Decision::Deny => {
                self.note_denial(now);
                self.log(action, class, &target, None, "deny", "click", "denied");
                Err("Denied by the user".into())
            }
            Decision::DenyAndStop => {
                self.note_denial(now);
                self.panic("deny-and-stop");
                self.log(action, class, &target, None, "deny-stop", "click", "denied");
                Err("Denied by the user, permissions revoked".into())
            }
        }
    }

    fn note_denial(&self, now: Instant) {
        self.denials.lock().unwrap().push(now);
    }

    /// Three denials within a minute pause new requests for the rest of that minute.
    fn cooling_down(&self, now: Instant) -> bool {
        let mut denials = self.denials.lock().unwrap();
        denials.retain(|t| now.duration_since(*t) < DENIAL_WINDOW);
        denials.len() >= MAX_DENIALS
    }

    /// Record how an authorized action ended.
    pub fn finish(&self, action: &str, params: &Value, auth: &Authorization, outcome: &Result<Value, String>) {
        let Some(class) = classify(action) else { return };
        if class == ActionClass::Info {
            return;
        }
        let result = match outcome {
            Ok(_) => "ok".to_string(),
            Err(e) => format!("error: {}", e.chars().take(120).collect::<String>()),
        };
        self.log(action, class, &target_of(action, params), auth.grant_id.as_deref(), "done", auth.decided_by, &result);
    }

    /// Revoke every grant and invalidate cards that are still open. Works without the core.
    pub fn panic(&self, why: &str) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let count = self.grants.lock().unwrap().revoke_all();
        self.audit.append(Entry::new("panic", "-", None, None, "revoke", why, &format!("{count} grants")));
    }

    /// Audit the user's answer to a card shown on behalf of a core tool.
    pub fn record_core_consent(&self, tool: &str, decision: &str) {
        self.audit.append(Entry::new("core_tool", "tool", Some(tool), None, decision, "click", "answered"));
    }

    /// Audit a capture the user took on purpose with their own shortcut and then sent or discarded.
    pub fn record_user_capture(&self, mode: &str, decision: &str) {
        self.audit.append(Entry::new("user_capture", "observe", Some(mode), None, decision, "user", "ok"));
    }

    /// Core disconnected or the session ended: task grants do not survive it.
    pub fn session_ended(&self) {
        if self.grants.lock().unwrap().revoke_all() > 0 {
            self.audit.append(Entry::new("session", "-", None, None, "revoke", "disconnect", "grants cleared"));
        }
    }

    #[allow(dead_code)]
    pub fn revoke(&self, grant_id: &str) -> bool {
        self.grants.lock().unwrap().revoke(grant_id)
    }

    #[allow(dead_code)]
    pub fn snapshot(&self) -> Vec<Value> {
        self.grants.lock().unwrap().list(Instant::now()).iter().map(Grant::to_json).collect()
    }

    #[allow(dead_code)]
    pub fn has_active_grants(&self) -> bool {
        !self.grants.lock().unwrap().list(Instant::now()).is_empty()
    }

    #[allow(clippy::too_many_arguments)]
    fn log(&self, action: &str, class: ActionClass, target: &Option<String>, grant: Option<&str>, decision: &str, by: &str, outcome: &str) {
        self.audit.append(Entry::new(action, class.name(), target.as_deref(), grant, decision, by, outcome));
    }

    #[allow(dead_code)]
    pub fn active(&self) -> u64 {
        self.active.load(Ordering::SeqCst)
    }
}

/// Summary the avatar badge uses: which kind of power is currently granted.
#[allow(dead_code)]
pub fn badge(grants: &[Value]) -> &'static str {
    let has = |c: &str| grants.iter().any(|g| g["class"] == c);
    if has("input") || has("window") || has("clipboard-write") || has("clipboard-read") {
        "control"
    } else if has("observe") {
        "observe"
    } else {
        "none"
    }
}

#[allow(dead_code)]
pub fn describe(request: &ConsentRequest) -> Value {
    json!({ "action": request.action, "class": request.class.name(), "target": request.target })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct Fixed(Decision, AtomicUsize);
    impl Decider for Fixed {
        fn ask(&self, _: &ConsentRequest) -> Decision {
            self.1.fetch_add(1, Ordering::SeqCst);
            self.0
        }
    }

    fn guard(decision: Decision) -> (Guard, Arc<Fixed>, std::path::PathBuf) {
        let d = Arc::new(Fixed(decision, AtomicUsize::new(0)));
        let path = std::env::temp_dir().join(format!("kali-audit-{}-{:?}.jsonl", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_file(&path);
        (Guard::new(d.clone(), Audit::new(path.clone()), Policy::default()), d, path)
    }

    #[test]
    fn unknown_actions_are_rejected_and_info_never_asks() {
        let (g, d, _) = guard(Decision::Deny);
        assert!(g.authorize("rm_rf", &json!({}), "").is_err());
        assert!(g.authorize("list_monitors", &json!({}), "").is_ok());
        assert_eq!(d.1.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn denied_by_default_and_never_runs() {
        let (g, d, _) = guard(Decision::Deny);
        assert!(g.authorize("screenshot", &json!({}), "look").is_err());
        assert_eq!(d.1.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn once_does_not_create_a_grant() {
        let (g, d, _) = guard(Decision::Once);
        assert!(g.authorize("screenshot", &json!({}), "").is_ok());
        assert!(g.authorize("screenshot", &json!({}), "").is_ok());
        assert_eq!(d.1.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn task_grant_covers_the_same_target_only() {
        let (g, d, _) = guard(Decision::Task);
        let a = g.authorize("screenshot", &json!({ "output": "DP-1" }), "").unwrap();
        assert!(a.grant_id.is_some());
        g.authorize("screenshot", &json!({ "output": "DP-1" }), "").unwrap();
        assert_eq!(d.1.load(Ordering::SeqCst), 1);
        g.authorize("screenshot", &json!({ "output": "HDMI-A-1" }), "").unwrap();
        assert_eq!(d.1.load(Ordering::SeqCst), 2);
        assert_eq!(badge(&g.snapshot()), "observe");
    }

    #[test]
    fn panic_revokes_and_deny_and_stop_revokes() {
        let (g, _, _) = guard(Decision::Task);
        g.authorize("screenshot", &json!({}), "").unwrap();
        assert!(g.has_active_grants());
        g.panic("test");
        assert!(!g.has_active_grants());
        let (g, _, _) = guard(Decision::DenyAndStop);
        assert!(g.authorize("launch_app", &json!({ "name": "firefox" }), "").is_err());
    }

    #[test]
    fn session_end_clears_grants() {
        let (g, _, _) = guard(Decision::Task);
        g.authorize("screenshot", &json!({}), "").unwrap();
        g.session_ended();
        assert!(!g.has_active_grants());
    }

    #[test]
    fn answer_after_panic_is_discarded() {
        struct PanicsDuringAsk(std::sync::OnceLock<Arc<Guard>>);
        impl Decider for PanicsDuringAsk {
            fn ask(&self, _: &ConsentRequest) -> Decision {
                self.0.get().unwrap().panic("during ask");
                Decision::Once
            }
        }
        let d = Arc::new(PanicsDuringAsk(Default::default()));
        let path = std::env::temp_dir().join(format!("kali-audit-race-{}.jsonl", std::process::id()));
        let g = Arc::new(Guard::new(d.clone(), Audit::new(path), Policy::default()));
        d.0.set(g.clone()).ok();
        assert!(g.authorize("screenshot", &json!({}), "").is_err());
    }

    #[test]
    fn allowlist_applies_to_launch_only() {
        let (g, d, _) = guard(Decision::Deny);
        g.set_policy(Policy { launch_allowlist: vec!["firefox".into(), "screenshot".into()] });
        assert_eq!(g.authorize("launch_app", &json!({ "name": "firefox" }), "").unwrap().decided_by, "allowlist");
        assert!(g.authorize("launch_app", &json!({ "name": "steam" }), "").is_err());
        assert!(g.authorize("screenshot", &json!({}), "").is_err());
        assert_eq!(d.1.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn every_decision_is_audited_and_the_chain_verifies() {
        let (g, _, path) = guard(Decision::Once);
        let auth = g.authorize("launch_app", &json!({ "name": "firefox" }), "open it").unwrap();
        g.finish("launch_app", &json!({ "name": "firefox" }), &auth, &Ok(json!({})));
        let _ = g.authorize("rm_rf", &json!({}), "");
        assert_eq!(audit::verify(&path), Ok(2));
    }

    #[test]
    fn three_denials_pause_new_requests_without_showing_a_card() {
        let (g, d, _) = guard(Decision::Deny);
        for _ in 0..3 {
            assert!(g.authorize("screenshot", &json!({}), "").is_err());
        }
        assert_eq!(d.1.load(Ordering::SeqCst), 3);
        let err = g.authorize("screenshot", &json!({}), "").unwrap_err();
        assert!(err.contains("Too many"));
        assert_eq!(d.1.load(Ordering::SeqCst), 3, "no fourth card");
        // Read-only info is unaffected.
        assert!(g.authorize("list_monitors", &json!({}), "").is_ok());
    }

    #[test]
    fn window_actions_are_classified() {
        assert_eq!(classify("list_windows"), Some(ActionClass::Observe));
        assert_eq!(classify("focus_window"), Some(ActionClass::Window));
        assert_eq!(target_of("focus_window", &json!({ "id": "0xabc" })).as_deref(), Some("0xabc"));
        let (g, d, _) = guard(Decision::Deny);
        assert!(g.authorize("focus_window", &json!({ "id": "0xabc" }), "").is_err());
        assert_eq!(d.1.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn machine_actions_are_classified() {
        assert_eq!(classify("system_info"), Some(ActionClass::Info));
        assert_eq!(classify("run_command"), Some(ActionClass::Shell));
        assert_eq!(classify("fs_read"), Some(ActionClass::Files));
        assert_eq!(classify("fs_list"), Some(ActionClass::Files));
        // The card shows the command itself, cut at 300 chars.
        assert_eq!(target_of("run_command", &json!({ "command": "  df -h  " })).as_deref(), Some("df -h"));
        assert_eq!(target_of("run_command", &json!({ "command": "x".repeat(500) })).unwrap().len(), 300);
        assert_eq!(target_of("fs_read", &json!({ "path": "/home/u/a" })), None);
    }

    #[test]
    fn system_info_never_asks_but_commands_always_do() {
        let (g, d, _) = guard(Decision::Once);
        assert!(g.authorize("system_info", &json!({}), "").is_ok());
        assert_eq!(d.1.load(Ordering::SeqCst), 0);
        for _ in 0..3 {
            assert!(g.authorize("run_command", &json!({ "command": "df -h" }), "").is_ok());
        }
        assert_eq!(d.1.load(Ordering::SeqCst), 3, "one card per command");
    }

    #[test]
    fn a_command_cannot_be_approved_for_the_task() {
        assert!(!ActionClass::Shell.allows_task_grant());
        let (g, d, _) = guard(Decision::Task);
        assert!(g.authorize("run_command", &json!({ "command": "ls" }), "").is_err(), "'allow this task' is not honoured for shell");
        assert!(!g.has_active_grants());
        assert_eq!(d.1.load(Ordering::SeqCst), 1);
        // Files may be granted for the task, but a grant for files never covers a command.
        let (g, d, _) = guard(Decision::Task);
        g.authorize("fs_list", &json!({ "path": "/home/u" }), "").unwrap();
        g.authorize("fs_read", &json!({ "path": "/home/u/a" }), "").unwrap();
        assert_eq!(d.1.load(Ordering::SeqCst), 1);
        assert!(g.authorize("run_command", &json!({ "command": "ls" }), "").is_err());
    }

    #[test]
    fn clipboard_read_never_gets_task_grants() {
        assert!(!ActionClass::ClipboardRead.allows_task_grant());
        assert!(ActionClass::Input.max_ttl() <= Duration::from_secs(600));
    }
}
