//! Time-boxed, scoped permissions. Time is passed in so tests do not sleep.

use super::ActionClass;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct Grant {
    pub id: String,
    pub class: ActionClass,
    /// App or monitor the grant is bound to; `None` covers any target of the class.
    pub target: Option<String>,
    expires: Instant,
    remaining: u32,
}

impl Grant {
    pub fn new(class: ActionClass, target: Option<String>, now: Instant, ttl: Duration, max_actions: u32) -> Grant {
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        Grant { id: format!("g_{n}"), class, target, expires: now + ttl, remaining: max_actions }
    }

    fn live(&self, now: Instant) -> bool {
        self.remaining > 0 && now < self.expires
    }

    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id, "class": self.class.name(), "target": self.target,
            "remaining": self.remaining, "expires_in_s": self.expires.saturating_duration_since(Instant::now()).as_secs(),
        })
    }
}

#[derive(Default)]
pub struct Grants {
    items: Vec<Grant>,
}

impl Grants {
    pub fn add(&mut self, grant: Grant) {
        self.items.push(grant);
    }

    /// Use one action of a matching grant. A grant bound to a target never covers another target,
    /// and an untargeted request is only covered by an untargeted grant.
    pub fn consume(&mut self, class: ActionClass, target: Option<&str>, now: Instant) -> Option<String> {
        self.items.retain(|g| g.live(now));
        let grant = self.items.iter_mut().find(|g| g.class == class && g.target.as_deref() == target)?;
        grant.remaining -= 1;
        Some(grant.id.clone())
    }

    pub fn revoke(&mut self, id: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|g| g.id != id);
        self.items.len() != before
    }

    pub fn revoke_all(&mut self) -> usize {
        let n = self.items.len();
        self.items.clear();
        n
    }

    pub fn list(&mut self, now: Instant) -> Vec<Grant> {
        self.items.retain(|g| g.live(now));
        self.items.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(now: Instant, ttl: u64, n: u32) -> Grant {
        Grant::new(ActionClass::Observe, Some("DP-1".into()), now, Duration::from_secs(ttl), n)
    }

    #[test]
    fn expires_by_time() {
        let t0 = Instant::now();
        let mut g = Grants::default();
        g.add(grant(t0, 60, 5));
        assert!(g.consume(ActionClass::Observe, Some("DP-1"), t0 + Duration::from_secs(59)).is_some());
        assert!(g.consume(ActionClass::Observe, Some("DP-1"), t0 + Duration::from_secs(61)).is_none());
        assert!(g.list(t0 + Duration::from_secs(61)).is_empty());
    }

    #[test]
    fn expires_by_count() {
        let t0 = Instant::now();
        let mut g = Grants::default();
        g.add(grant(t0, 60, 2));
        assert!(g.consume(ActionClass::Observe, Some("DP-1"), t0).is_some());
        assert!(g.consume(ActionClass::Observe, Some("DP-1"), t0).is_some());
        assert!(g.consume(ActionClass::Observe, Some("DP-1"), t0).is_none());
    }

    #[test]
    fn scope_and_class_must_match() {
        let t0 = Instant::now();
        let mut g = Grants::default();
        g.add(grant(t0, 60, 5));
        assert!(g.consume(ActionClass::Observe, Some("HDMI-A-1"), t0).is_none());
        assert!(g.consume(ActionClass::Observe, None, t0).is_none());
        assert!(g.consume(ActionClass::Launch, Some("DP-1"), t0).is_none());
    }

    #[test]
    fn revoke_one_and_all() {
        let t0 = Instant::now();
        let mut g = Grants::default();
        let a = grant(t0, 60, 5);
        let id = a.id.clone();
        g.add(a);
        g.add(grant(t0, 60, 5));
        assert!(g.revoke(&id));
        assert!(!g.revoke(&id));
        assert_eq!(g.revoke_all(), 1);
    }
}
