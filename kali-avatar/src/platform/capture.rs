//! Screenshot helpers shared by the backends. Capture shells out to the tool that matches the
//! session instead of linking heavy libraries, which keeps the resident binary small.

use super::{Desktop, Monitor};
use std::path::Path;
use std::process::Command;

pub fn run(cmd: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = Command::new(cmd).args(args).output().map_err(|e| format!("{cmd} unavailable: {e}"))?;
    if !out.status.success() {
        return Err(format!("{cmd} failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout)
}

pub fn which(cmd: &str) -> bool {
    std::env::var_os("PATH").map_or(false, |paths| std::env::split_paths(&paths).any(|dir| dir.join(cmd).is_file()))
}

pub fn read_and_remove(path: &Path) -> Result<Vec<u8>, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(path);
    data
}

/// Wayland: KWin does not implement wlr-screencopy, so grim fails there: prefer spectacle on KDE
/// (full desktop, no portal prompt) and fall back to grim when it is missing or fails.
pub fn wayland(desktop: Desktop, target: Option<&Monitor>, tmp: &Path) -> Result<Vec<u8>, String> {
    let tmp_str = tmp.to_string_lossy().to_string();
    let mut grim_args: Vec<&str> = Vec::new();
    if let Some(m) = target {
        grim_args.extend(["-o", m.name.as_str()]);
    }
    grim_args.push("-");
    if desktop == Desktop::Kde && which("spectacle") {
        match run("spectacle", &["-b", "-n", "-f", "-o", &tmp_str]).and_then(|_| read_and_remove(tmp)) {
            Ok(png) => Ok(png),
            Err(e) if which("grim") => run("grim", &grim_args).map_err(|g| format!("{e}; {g}")),
            Err(e) => Err(e),
        }
    } else if which("grim") {
        run("grim", &grim_args)
    } else if desktop == Desktop::Gnome && which("gnome-screenshot") {
        run("gnome-screenshot", &["-f", &tmp_str])?;
        read_and_remove(tmp)
    } else {
        Err("No screenshot tool for this Wayland session (install grim, spectacle or gnome-screenshot)".into())
    }
}

/// X11: maim (per monitor via geometry) or scrot.
pub fn x11(target: Option<&Monitor>, tmp: &Path) -> Result<Vec<u8>, String> {
    let tmp_str = tmp.to_string_lossy().to_string();
    if which("maim") {
        match target {
            Some(m) if m.width > 0 => {
                let geometry = format!("{}x{}+{}+{}", m.width, m.height, m.x, m.y);
                run("maim", &["-g", &geometry, &tmp_str])?;
            }
            _ => {
                run("maim", &[&tmp_str])?;
            }
        }
        read_and_remove(tmp)
    } else if which("scrot") {
        run("scrot", &["-o", &tmp_str])?;
        read_and_remove(tmp)
    } else {
        Err("No screenshot tool for this X11 session (install maim or scrot)".into())
    }
}

/// A `slurp` geometry (`X,Y WxH`, possibly negative) and nothing else, before it reaches `grim -g`.
pub fn valid_geometry(g: &str) -> bool {
    let g = g.trim();
    !g.is_empty() && g.len() <= 40 && g.chars().all(|c| c.is_ascii_digit() || matches!(c, ',' | ' ' | 'x' | '-')) && g.matches(' ').count() == 1
}

/// Wayland: the user drags a rectangle (slurp, or the compositor's own selector) and only that
/// region is captured. Cancelling the selection is an error, not a full-screen fallback.
pub fn region_wayland(desktop: Desktop, tmp: &Path) -> Result<Vec<u8>, String> {
    let tmp_str = tmp.to_string_lossy().to_string();
    if desktop == Desktop::Kde && which("spectacle") {
        run("spectacle", &["-b", "-n", "-r", "-o", &tmp_str])?;
        return read_and_remove(tmp);
    }
    if which("slurp") && which("grim") {
        let geometry = String::from_utf8_lossy(&run("slurp", &[])?).trim().to_string();
        if geometry.is_empty() {
            return Err("Selection cancelled".into());
        }
        if !valid_geometry(&geometry) {
            return Err("Unexpected selection geometry".into());
        }
        return run("grim", &["-g", &geometry, "-"]);
    }
    if desktop == Desktop::Gnome && which("gnome-screenshot") {
        run("gnome-screenshot", &["-a", "-f", &tmp_str])?;
        return read_and_remove(tmp);
    }
    Err("Region capture needs slurp and grim (or spectacle on KDE, gnome-screenshot on GNOME)".into())
}

/// X11: `maim -s`, the user drags a rectangle.
pub fn region_x11(tmp: &Path) -> Result<Vec<u8>, String> {
    if !which("maim") {
        return Err("Region capture on X11 needs maim".into());
    }
    let tmp_str = tmp.to_string_lossy().to_string();
    run("maim", &["-s", &tmp_str])?;
    read_and_remove(tmp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_geometries_reach_grim() {
        assert!(valid_geometry("10,20 300x200\n"));
        assert!(valid_geometry("-5,0 10x10"));
        for bad in ["", "10,20 300x200; rm", "$(id)", "10,20 300x200 extra", "--help", "10,20,30"] {
            assert!(!valid_geometry(bad), "{bad:?}");
        }
    }
}
