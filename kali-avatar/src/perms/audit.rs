//! Append-only audit log, one JSON object per line, each carrying the SHA-256 of the previous
//! line so any edit or deletion in the middle is detectable. Lives on the machine that acts.
//! It never stores typed or captured content, only what was asked and what was decided.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Entry {
    pub action: String,
    pub class: String,
    pub target: Option<String>,
    pub grant: Option<String>,
    pub decision: String,
    pub by: String,
    pub outcome: String,
}

impl Entry {
    pub fn new(action: &str, class: &str, target: Option<&str>, grant: Option<&str>, decision: &str, by: &str, outcome: &str) -> Entry {
        Entry {
            action: action.into(),
            class: class.into(),
            target: target.map(|t| t.chars().take(120).collect()),
            grant: grant.map(Into::into),
            decision: decision.into(),
            by: by.into(),
            outcome: outcome.into(),
        }
    }
}

pub struct Audit {
    path: PathBuf,
    lock: Mutex<()>,
}

pub fn default_path() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/state")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("kali").join("audit.jsonl")
}

fn digest(line: &str) -> String {
    Sha256::digest(line.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

impl Audit {
    pub fn new(path: PathBuf) -> Audit {
        Audit { path, lock: Mutex::new(()) }
    }

    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Best effort: failing to write must not turn a denied action into an allowed one, nor crash.
    pub fn append(&self, entry: Entry) {
        use std::os::unix::fs::OpenOptionsExt;
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let prev = std::fs::read_to_string(&self.path).ok().and_then(|s| s.lines().last().map(digest)).unwrap_or_default();
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let line = json!({
            "ts": ts, "action": entry.action, "class": entry.class, "target": entry.target, "grant": entry.grant,
            "decision": entry.decision, "by": entry.by, "outcome": entry.outcome, "prev": prev,
        })
        .to_string();
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).mode(0o600).open(&self.path) {
            let _ = writeln!(file, "{line}");
        }
    }
}

/// Check the hash chain. Returns the number of entries, or the 1-based line that does not match.
pub fn verify(path: &Path) -> Result<usize, usize> {
    let text = std::fs::read_to_string(path).map_err(|_| 0usize)?;
    let mut prev = String::new();
    let mut count = 0;
    for (i, line) in text.lines().enumerate() {
        let value: Value = serde_json::from_str(line).map_err(|_| i + 1)?;
        if value["prev"].as_str() != Some(prev.as_str()) {
            return Err(i + 1);
        }
        prev = digest(line);
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("kali-audit-{name}-{}.jsonl", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn chain_verifies_and_detects_edits() {
        let path = tmp("chain");
        let audit = Audit::new(path.clone());
        for i in 0..3 {
            audit.append(Entry::new("screenshot", "observe", Some("DP-1"), None, "allow-once", "click", &format!("n{i}")));
        }
        assert_eq!(verify(&path), Ok(3));
        let text = std::fs::read_to_string(&path).unwrap().replace("allow-once", "allow-task");
        std::fs::write(&path, text).unwrap();
        assert!(verify(&path).is_err());
    }

    #[test]
    fn deleting_a_middle_line_breaks_the_chain() {
        let path = tmp("delete");
        let audit = Audit::new(path.clone());
        for i in 0..3 {
            audit.append(Entry::new("launch_app", "launch", Some("x"), None, "allow", "click", &format!("n{i}")));
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let kept: Vec<&str> = text.lines().enumerate().filter(|(i, _)| *i != 1).map(|(_, l)| l).collect();
        std::fs::write(&path, kept.join("\n") + "\n").unwrap();
        assert_eq!(verify(&path), Err(2));
    }
}
