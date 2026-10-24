//! The user's machine as a tool target: `system_info`, `run_command`, `fs_read` and `fs_list`.
//!
//! The core routes these here by default (see `kali_core.targets`), so "my RAM" is the RAM of the
//! PC the user is sitting at. Permission is decided by `perms` before anything in this module runs;
//! what this module adds is the limits that hold even after a yes: files stay under the home
//! folder and away from credential stores, commands have a timeout and bounded output.
//!
//! Plain std on purpose: no GUI types, so it is tested without a display.

use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MAX_COMMAND_LEN: usize = 8000;
const DEFAULT_TIMEOUT_S: u64 = 30;
const MAX_TIMEOUT_S: u64 = 300;
/// Per stream. The rest of the output is read and dropped so the child never blocks on a full pipe.
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_FILE_BYTES: usize = 256 * 1024;
const DEFAULT_LINES: usize = 200;
const MAX_LINES: usize = 2000;
const MAX_ENTRIES: usize = 500;

// ── names ───────────────────────────────────────────────────────────────────────────────────────

/// Name of this machine, as shown in every answer (`[minigun]`). Printable, short, never empty.
pub fn hostname() -> String {
    let raw = std::fs::read_to_string("/proc/sys/kernel/hostname")
        .or_else(|_| std::fs::read_to_string("/etc/hostname"))
        .ok()
        .or_else(|| std::env::var("COMPUTERNAME").ok())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .or_else(|| Command::new("hostname").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()))
        .unwrap_or_default();
    clean_hostname(&raw)
}

fn clean_hostname(raw: &str) -> String {
    let name: String = raw.trim().chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).take(40).collect();
    if name.is_empty() {
        "desktop".into()
    } else {
        name
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).filter(|p| p.is_dir())
}

// ── system_info ─────────────────────────────────────────────────────────────────────────────────

/// `/proc/meminfo` → MB for the keys we report.
pub fn parse_meminfo(text: &str) -> Value {
    let mut out = serde_json::Map::new();
    for line in text.lines() {
        let Some((key, rest)) = line.split_once(':') else { continue };
        let name = match key {
            "MemTotal" => "total_mb",
            "MemAvailable" => "available_mb",
            "SwapTotal" => "swap_total_mb",
            "SwapFree" => "swap_free_mb",
            _ => continue,
        };
        if let Some(kb) = rest.split_whitespace().next().and_then(|v| v.parse::<u64>().ok()) {
            out.insert(name.into(), json!(kb / 1024));
        }
    }
    if let (Some(total), Some(avail)) = (out.get("total_mb").and_then(Value::as_u64), out.get("available_mb").and_then(Value::as_u64)) {
        out.insert("used_mb".into(), json!(total.saturating_sub(avail)));
    }
    Value::Object(out)
}

/// `/proc/cpuinfo` → (model name, logical cores).
pub fn parse_cpuinfo(text: &str) -> (Option<String>, usize) {
    let mut model = None;
    let mut cores = 0;
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        match key.trim() {
            "processor" => cores += 1,
            "model name" if model.is_none() => model = Some(value.trim().to_string()),
            _ => {}
        }
    }
    (model, cores)
}

/// `df -kP` output → disks worth reporting (real filesystems of at least 512 MB).
pub fn parse_df(text: &str) -> Vec<Value> {
    const SKIP_FS: [&str; 8] = ["tmpfs", "devtmpfs", "overlay", "squashfs", "efivarfs", "proc", "sysfs", "cgroup"];
    let mut disks = Vec::new();
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 6 || SKIP_FS.contains(&cols[0]) {
            continue;
        }
        let (Ok(total_kb), Ok(free_kb)) = (cols[1].parse::<u64>(), cols[3].parse::<u64>()) else { continue };
        let mount = cols[5..].join(" ");
        if total_kb < 512 * 1024 || ["/proc", "/sys", "/dev", "/run", "/snap"].iter().any(|p| mount.starts_with(p)) {
            continue;
        }
        let gb = |kb: u64| (kb as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0;
        disks.push(json!({ "mount": mount, "fs": cols[0], "total_gb": gb(total_kb), "free_gb": gb(free_kb) }));
        if disks.len() >= 12 {
            break;
        }
    }
    disks
}

/// `nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv,noheader,nounits`.
pub fn parse_nvidia(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|line| {
            let p: Vec<&str> = line.split(',').map(str::trim).collect();
            if p.len() != 3 {
                return None;
            }
            Some(json!({ "name": p[0], "vram_total_mb": p[1].parse::<u64>().ok()?, "vram_used_mb": p[2].parse::<u64>().ok()? }))
        })
        .collect()
}

fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn os_name() -> String {
    if let Ok(release) = std::fs::read_to_string("/etc/os-release") {
        if let Some(line) = release.lines().find(|l| l.starts_with("PRETTY_NAME=")) {
            return line["PRETTY_NAME=".len()..].trim().trim_matches('"').to_string();
        }
    }
    std::env::consts::OS.to_string()
}

/// Facts about this machine. Anything the platform cannot tell is left out rather than guessed.
pub fn system_info() -> Value {
    #[allow(unused_mut)] // only the macOS and Windows branches reassign it
    let mut memory = std::fs::read_to_string("/proc/meminfo").map(|t| parse_meminfo(&t)).unwrap_or_else(|_| json!({}));
    #[cfg(target_os = "macos")]
    if memory.get("total_mb").is_none() {
        if let Some(bytes) = run_capture("sysctl", &["-n", "hw.memsize"]).and_then(|s| s.trim().parse::<u64>().ok()) {
            memory = json!({ "total_mb": bytes / 1024 / 1024 });
        }
    }
    #[cfg(windows)]
    if memory.get("total_mb").is_none() {
        let script = "$o=Get-CimInstance Win32_OperatingSystem; \"$($o.TotalVisibleMemorySize) $($o.FreePhysicalMemory)\"";
        if let Some(text) = run_capture("powershell", &["-NoProfile", "-Command", script]) {
            let kb: Vec<u64> = text.split_whitespace().filter_map(|v| v.parse().ok()).collect();
            if let [total, free] = kb[..] {
                memory = json!({ "total_mb": total / 1024, "available_mb": free / 1024, "used_mb": total.saturating_sub(free) / 1024 });
            }
        }
    }

    let (model, cores) = std::fs::read_to_string("/proc/cpuinfo").map(|t| parse_cpuinfo(&t)).unwrap_or((None, 0));
    let mut cpu = json!({
        "model": model,
        "logical_cores": if cores > 0 { cores } else { std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0) },
    });
    if let Some(load) = std::fs::read_to_string("/proc/loadavg").ok().map(|t| t.split_whitespace().take(3).filter_map(|v| v.parse::<f64>().ok()).collect::<Vec<_>>()).filter(|l| l.len() == 3) {
        cpu["load_avg"] = json!(load);
    }

    let mut info = json!({
        "host": hostname(),
        "os": os_name(),
        "cpu": cpu,
        "memory": memory,
        "disks": run_capture("df", &["-kP"]).map(|t| parse_df(&t)).unwrap_or_default(),
        "gpus": run_capture("nvidia-smi", &["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"]).map(|t| parse_nvidia(&t)).unwrap_or_default(),
    });
    if let Some(kernel) = std::fs::read_to_string("/proc/sys/kernel/osrelease").ok().map(|s| s.trim().to_string()) {
        info["kernel"] = json!(kernel);
    }
    if let Some(up) = std::fs::read_to_string("/proc/uptime").ok().and_then(|t| t.split_whitespace().next().and_then(|v| v.parse::<f64>().ok())) {
        info["uptime_s"] = json!(up as u64);
    }
    info
}

// ── run_command ─────────────────────────────────────────────────────────────────────────────────

fn read_capped(mut stream: impl Read + Send + 'static) -> std::thread::JoinHandle<(Vec<u8>, bool)> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        let mut truncated = false;
        let mut buf = [0u8; 8192];
        loop {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let room = MAX_OUTPUT_BYTES.saturating_sub(kept.len());
                    kept.extend_from_slice(&buf[..n.min(room)]);
                    truncated |= n > room;
                }
            }
        }
        (kept, truncated)
    })
}

/// Stop the command and anything it started.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        // The child leads its own process group (see below), so `-pid` reaches its descendants.
        // `-s KILL -- -pid` is deliberate: procps 4.0.4 reads `kill -KILL -pid` as `kill(-1, SIGKILL)`,
        // which kills every process of the user.
        let _ = Command::new("kill").args(["-s", "KILL", "--", &format!("-{}", child.id())]).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn run_command(params: &Value) -> Result<Value, String> {
    let command = params.get("command").and_then(Value::as_str).map(str::trim).filter(|c| !c.is_empty()).ok_or("Missing 'command'")?;
    if command.len() > MAX_COMMAND_LEN {
        return Err("Command too long".into());
    }
    let timeout = Duration::from_secs(params.get("timeout").and_then(Value::as_u64).unwrap_or(DEFAULT_TIMEOUT_S).clamp(1, MAX_TIMEOUT_S));
    let cwd = match params.get("cwd").and_then(Value::as_str).filter(|c| !c.is_empty()) {
        Some(dir) => {
            let dir = expand_home(dir);
            if !dir.is_dir() {
                return Err(format!("Working directory not found: {}", dir.display()));
            }
            dir
        }
        None => home_dir().ok_or("No home directory")?,
    };

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        std::os::unix::process::CommandExt::process_group(&mut c, 0);
        c
    };
    let mut child = cmd
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start: {e}"))?;
    let out = read_capped(child.stdout.take().ok_or("no stdout")?);
    let err = read_capped(child.stderr.take().ok_or("no stderr")?);

    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if started.elapsed() >= timeout => {
                kill_tree(&mut child);
                return Err(format!("Command timed out after {}s", timeout.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    let (stdout, out_cut) = out.join().unwrap_or_default();
    let (stderr, err_cut) = err.join().unwrap_or_default();
    Ok(json!({
        "exit_code": status.code().unwrap_or(-1),
        "stdout": String::from_utf8_lossy(&stdout),
        "stderr": String::from_utf8_lossy(&stderr),
        "command": command,
        "cwd": cwd.display().to_string(),
        "truncated": out_cut || err_cut,
        "host": hostname(),
    }))
}

// ── files ───────────────────────────────────────────────────────────────────────────────────────

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    match (path.strip_prefix("~/"), home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

/// Folders that hold credentials or session cookies. Never readable, even after a yes.
const SENSITIVE_DIRS: [&str; 10] = [
    ".ssh", ".gnupg", ".aws", ".kube", ".password-store", ".docker", ".mozilla", ".config/gcloud", ".config/google-chrome", ".config/chromium",
];

pub fn is_sensitive(path: &Path, home: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(home) else { return false };
    let rel = rel.to_string_lossy().replace('\\', "/");
    let name = rel.rsplit('/').next().unwrap_or("");
    SENSITIVE_DIRS.iter().any(|d| rel == *d || rel.starts_with(&format!("{d}/")))
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
        || name == ".netrc"
        || name == ".env"
        || name.ends_with(".pem")
        || name.ends_with(".kdbx")
}

/// Extra roots the user allows besides their home folder: `KALI_AVATAR_FS_ROOTS=/mnt/data:/srv/x`.
fn extra_roots() -> Vec<PathBuf> {
    std::env::var("KALI_AVATAR_FS_ROOTS")
        .map(|v| v.split(if cfg!(windows) { ';' } else { ':' }).filter(|p| !p.is_empty()).filter_map(|p| std::fs::canonicalize(p).ok()).collect())
        .unwrap_or_default()
}

/// Canonical path the agent may touch, or why not. Symlinks are resolved first, so a link inside
/// the home folder cannot lead out of it.
pub fn allowed_path(path: &str, roots: &[PathBuf], home: &Path) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Missing 'path'".into());
    }
    let expanded = if Path::new(path).is_absolute() { PathBuf::from(path) } else { expand_home(path) };
    let expanded = if expanded.is_absolute() { expanded } else { home.join(expanded) };
    let real = std::fs::canonicalize(&expanded).map_err(|_| format!("Not found: {}", expanded.display()))?;
    if is_sensitive(&real, home) {
        return Err("That location holds credentials and is never shared with Kali".into());
    }
    let home_real = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    if real.starts_with(&home_real) || roots.iter().any(|r| real.starts_with(r)) {
        Ok(real)
    } else {
        Err("Outside your home folder (add it to KALI_AVATAR_FS_ROOTS to allow it)".into())
    }
}

/// Canonical, permitted path from the `path` parameter, or why not. Used before the consent card
/// so the card names the real file and a forbidden one never reaches the user as a question.
pub fn resolve_path(params: &Value) -> Result<PathBuf, String> {
    let home = home_dir().ok_or("No home directory")?;
    let path = params.get("path").and_then(Value::as_str).ok_or("Missing 'path'")?;
    let home_real = std::fs::canonicalize(&home).unwrap_or(home);
    allowed_path(path, &extra_roots(), &home_real)
}

pub fn fs_read(params: &Value) -> Result<Value, String> {
    let max_lines = params.get("max_lines").and_then(Value::as_u64).map(|n| n as usize).unwrap_or(DEFAULT_LINES).clamp(1, MAX_LINES);
    read_file(&resolve_path(params)?, max_lines)
}

fn read_file(path: &Path, max_lines: usize) -> Result<Value, String> {
    if !path.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }
    let mut raw = Vec::new();
    std::fs::File::open(path).and_then(|f| f.take(MAX_FILE_BYTES as u64 + 1).read_to_end(&mut raw)).map_err(|e| format!("Read error: {e}"))?;
    let mut truncated = raw.len() > MAX_FILE_BYTES;
    raw.truncate(MAX_FILE_BYTES);
    let text = String::from_utf8_lossy(&raw);
    let mut lines: Vec<&str> = text.lines().collect();
    if lines.len() > max_lines {
        lines.truncate(max_lines);
        truncated = true;
    }
    Ok(json!({ "content": lines.join("\n"), "path": path.display().to_string(), "lines": lines.len(), "truncated": truncated, "host": hostname() }))
}

pub fn fs_list(params: &Value) -> Result<Value, String> {
    let home_real = home_dir().and_then(|h| std::fs::canonicalize(h).ok()).unwrap_or_default();
    list_dir(&resolve_path(params)?, &home_real)
}

fn list_dir(path: &Path, home_real: &Path) -> Result<Value, String> {
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }
    let mut entries: Vec<(String, bool, Option<u64>)> = std::fs::read_dir(path)
        .map_err(|e| format!("Read error: {e}"))?
        .filter_map(Result::ok)
        // Credential folders do not even show up in a listing.
        .filter(|e| !is_sensitive(&e.path(), home_real))
        .map(|e| {
            let meta = e.metadata().ok();
            let is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
            (e.file_name().to_string_lossy().into_owned(), is_dir, meta.filter(|m| m.is_file()).map(|m| m.len()))
        })
        .collect();
    entries.sort();
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    let list: Vec<Value> = entries.into_iter().map(|(name, dir, size)| json!({ "name": name, "type": if dir { "dir" } else { "file" }, "size": size })).collect();
    Ok(json!({ "entries": list, "path": path.display().to_string(), "truncated": truncated, "host": hostname() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kali-machine-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".ssh")).unwrap();
        std::fs::create_dir_all(dir.join("docs")).unwrap();
        std::fs::write(dir.join("docs/a.txt"), "one\ntwo\nthree\n").unwrap();
        std::fs::write(dir.join(".ssh/id_rsa"), "secret").unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn meminfo_is_reported_in_mb_with_used() {
        let v = parse_meminfo("MemTotal:       32768000 kB\nMemFree: 1 kB\nMemAvailable:   16384000 kB\nSwapTotal: 2048000 kB\nSwapFree: 2048000 kB\n");
        assert_eq!(v["total_mb"], 32000);
        assert_eq!(v["available_mb"], 16000);
        assert_eq!(v["used_mb"], 16000);
        assert_eq!(v["swap_total_mb"], 2000);
    }

    #[test]
    fn cpuinfo_counts_logical_cores() {
        let (model, cores) = parse_cpuinfo("processor\t: 0\nmodel name\t: AMD Ryzen 9\nprocessor\t: 1\nmodel name\t: AMD Ryzen 9\n");
        assert_eq!((model.as_deref(), cores), (Some("AMD Ryzen 9"), 2));
    }

    #[test]
    fn df_keeps_real_disks_only() {
        let df = "Filesystem 1024-blocks Used Available Capacity Mounted on\n\
                  /dev/nvme0n1p2 976490576 100 500000000 17% /\n\
                  tmpfs 16000000 0 16000000 0% /dev/shm\n\
                  /dev/sda1 2000 1 1999 1% /boot/tiny\n\
                  /dev/sdb1 1953514584 1 1000000000 50% /mnt/data 2\n";
        let disks = parse_df(df);
        assert_eq!(disks.len(), 2);
        assert_eq!(disks[0]["mount"], "/");
        assert_eq!(disks[1]["mount"], "/mnt/data 2");
        assert_eq!(disks[0]["free_gb"], 476.8);
    }

    #[test]
    fn nvidia_output_is_parsed_and_junk_ignored() {
        let gpus = parse_nvidia("NVIDIA GeForce RTX 4090, 24564, 1200\nnot a gpu line\n");
        assert_eq!(gpus.len(), 1);
        assert_eq!(gpus[0]["vram_total_mb"], 24564);
    }

    #[test]
    fn hostnames_are_cleaned_for_display() {
        assert_eq!(clean_hostname("minigun\n"), "minigun");
        assert_eq!(clean_hostname("[evil] name"), "evilname");
        assert_eq!(clean_hostname("   "), "desktop");
        assert_eq!(clean_hostname(&"a".repeat(100)).len(), 40);
    }

    #[test]
    fn system_info_has_the_documented_shape() {
        let v = system_info();
        for key in ["host", "os", "cpu", "memory", "disks", "gpus"] {
            assert!(v.get(key).is_some(), "{key}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn run_command_captures_output_exit_code_and_cwd() {
        let v = run_command(&json!({ "command": "echo hi; echo oops >&2; exit 3", "cwd": "/tmp" })).unwrap();
        assert_eq!(v["stdout"], "hi\n");
        assert_eq!(v["stderr"], "oops\n");
        assert_eq!(v["exit_code"], 3);
        assert_eq!(v["cwd"], "/tmp");
        assert_eq!(v["truncated"], false);
    }

    #[cfg(unix)]
    #[test]
    fn run_command_times_out_and_kills_the_children() {
        let started = Instant::now();
        let err = run_command(&json!({ "command": "sleep 30 & sleep 30", "timeout": 1 })).unwrap_err();
        assert!(err.contains("timed out"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn run_command_bounds_the_output() {
        let v = run_command(&json!({ "command": "head -c 1000000 /dev/zero | tr '\\0' x" })).unwrap();
        assert_eq!(v["stdout"].as_str().unwrap().len(), MAX_OUTPUT_BYTES);
        assert_eq!(v["truncated"], true);
    }

    #[test]
    fn run_command_rejects_bad_input() {
        assert!(run_command(&json!({})).is_err());
        assert!(run_command(&json!({ "command": "   " })).is_err());
        assert!(run_command(&json!({ "command": "x".repeat(MAX_COMMAND_LEN + 1) })).is_err());
        assert!(run_command(&json!({ "command": "true", "cwd": "/definitely/not/here" })).is_err());
    }

    #[test]
    fn files_stay_inside_home_and_away_from_credentials() {
        let home = temp_home("fs");
        let none: Vec<PathBuf> = vec![];
        assert!(allowed_path("docs/a.txt", &none, &home).is_ok());
        assert!(allowed_path(&home.join("docs").display().to_string(), &none, &home).is_ok());
        assert!(allowed_path(".ssh/id_rsa", &none, &home).unwrap_err().contains("credentials"));
        assert!(allowed_path("/etc/passwd", &none, &home).unwrap_err().contains("Outside"));
        assert!(allowed_path("", &none, &home).is_err());
        // An allowed extra root opens that folder only.
        let other = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        assert!(allowed_path(&other.display().to_string(), &[other.clone()], &home).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_cannot_lead_out_of_home() {
        let home = temp_home("link");
        std::os::unix::fs::symlink("/etc", home.join("docs/etc")).unwrap();
        let none: Vec<PathBuf> = vec![];
        assert!(allowed_path("docs/etc/hostname", &none, &home).is_err());
        std::os::unix::fs::symlink(home.join(".ssh"), home.join("docs/keys")).unwrap();
        assert!(allowed_path("docs/keys/id_rsa", &none, &home).unwrap_err().contains("credentials"));
    }

    #[test]
    fn reads_and_lists_with_limits_and_without_credentials() {
        let home = temp_home("read");
        let v = read_file(&home.join("docs/a.txt"), 2).unwrap();
        assert_eq!(v["content"], "one\ntwo");
        assert_eq!(v["truncated"], true);
        assert!(read_file(&home.join("docs"), 2).is_err());
        let all = read_file(&home.join("docs/a.txt"), 10).unwrap();
        assert_eq!(all["lines"], 3);
        assert_eq!(all["truncated"], false);
        let listing = list_dir(&home, &home).unwrap();
        let names: Vec<&str> = listing["entries"].as_array().unwrap().iter().filter_map(|e| e["name"].as_str()).collect();
        assert_eq!(names, vec!["docs"], ".ssh is hidden");
        assert!(list_dir(&home.join("docs/a.txt"), &home).is_err());
    }

    #[test]
    fn sensitive_names_are_recognised() {
        let home = Path::new("/home/u");
        for p in ["/home/u/.ssh", "/home/u/.ssh/config", "/home/u/.aws/credentials", "/home/u/proj/.env", "/home/u/k/id_ed25519", "/home/u/x.kdbx", "/home/u/.config/gcloud/a"] {
            assert!(is_sensitive(Path::new(p), home), "{p}");
        }
        for p in ["/home/u/docs/a.txt", "/home/u/.config/kali/x", "/other/.ssh"] {
            assert!(!is_sensitive(Path::new(p), home), "{p}");
        }
    }
}
