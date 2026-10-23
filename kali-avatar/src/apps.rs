//! Application discovery and launching through GIO, which already knows every XDG data dir,
//! Flatpak and Snap exports, localized names, `OnlyShowIn`/`NoDisplay`, terminal apps and
//! D-Bus activation. Ranking is plain code so it can be tested without a desktop.

use gtk4::gio;
use gtk4::gio::prelude::*;
use serde_json::{json, Value};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct AppEntry {
    /// Desktop file id, e.g. `org.mozilla.firefox.desktop`.
    pub id: String,
    pub name: String,
    pub generic: String,
    pub keywords: Vec<String>,
    pub categories: Vec<String>,
    pub description: String,
}

fn norm(s: &str) -> String {
    s.to_lowercase()
}

fn bare_id(id: &str) -> String {
    norm(id.strip_suffix(".desktop").unwrap_or(id))
}

fn token_score(app: &AppEntry, q: &str) -> u32 {
    let id = bare_id(&app.id);
    let name = norm(&app.name);
    if id == q {
        return 100;
    }
    if name == q {
        return 95;
    }
    if id.rsplit('.').next() == Some(q) {
        return 90;
    }
    if name.starts_with(q) {
        return 80;
    }
    if name.split(|c: char| !c.is_alphanumeric()).any(|w| w.starts_with(q)) {
        return 70;
    }
    if name.contains(q) {
        return 60;
    }
    if norm(&app.generic).contains(q) || app.keywords.iter().any(|k| norm(k).contains(q)) {
        return 50;
    }
    if id.contains(q) {
        return 45;
    }
    if app.categories.iter().any(|c| norm(c) == q) {
        return 20;
    }
    if norm(&app.description).contains(q) {
        return 10;
    }
    0
}

/// Rank apps for a free-text query. Every word must match something; the score is the average.
pub fn rank<'a>(apps: &'a [AppEntry], query: &str) -> Vec<(u32, &'a AppEntry)> {
    let words: Vec<String> = norm(query).split_whitespace().map(str::to_string).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<(u32, &AppEntry)> = apps
        .iter()
        .filter_map(|app| {
            let scores: Vec<u32> = words.iter().map(|w| token_score(app, w)).collect();
            if scores.contains(&0) {
                return None;
            }
            Some((scores.iter().sum::<u32>() / scores.len() as u32, app))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    out
}

/// The one app a name refers to, or why it is ambiguous. Only exact matches launch: a fuzzy
/// guess must never open something other than what the card names.
pub fn resolve<'a>(apps: &'a [AppEntry], name: &str) -> Result<&'a AppEntry, String> {
    let q = norm(name.trim());
    let q = q.strip_suffix(".desktop").unwrap_or(&q).to_string();
    if let Some(app) = apps.iter().find(|a| bare_id(&a.id) == q) {
        return Ok(app);
    }
    let exact: Vec<&AppEntry> = apps.iter().filter(|a| norm(&a.name) == q).collect();
    let by_suffix: Vec<&AppEntry> = apps.iter().filter(|a| bare_id(&a.id).rsplit('.').next() == Some(q.as_str())).collect();
    match (exact.len(), by_suffix.len()) {
        (1, _) => return Ok(exact[0]),
        (0, 1) => return Ok(by_suffix[0]),
        _ => {}
    }
    let hints: Vec<String> = rank(apps, name).into_iter().take(3).map(|(_, a)| format!("{} ({})", a.name, bare_id(&a.id))).collect();
    if hints.is_empty() {
        Err(format!("No application matches '{name}'. Use find_apps to search."))
    } else {
        Err(format!("'{name}' is not an exact application id. Did you mean: {}?", hints.join(", ")))
    }
}

/// Visible applications on this system.
pub fn installed() -> Vec<AppEntry> {
    gio::AppInfo::all()
        .into_iter()
        .filter(|a| a.should_show())
        .filter_map(|a| {
            let id = a.id()?.to_string();
            let desktop = gio::DesktopAppInfo::new(&id);
            Some(AppEntry {
                name: a.name().to_string(),
                description: a.description().map(|d| d.to_string()).unwrap_or_default(),
                generic: desktop.as_ref().and_then(|d| d.generic_name()).map(|g| g.to_string()).unwrap_or_default(),
                keywords: desktop.as_ref().map(|d| d.keywords().iter().map(|k| k.to_string()).collect()).unwrap_or_default(),
                categories: desktop
                    .as_ref()
                    .and_then(|d| d.categories())
                    .map(|c| c.split(';').filter(|s| !s.is_empty()).map(str::to_string).collect())
                    .unwrap_or_default(),
                id,
            })
        })
        .collect()
}

/// `find_apps`: top matches for a query.
pub fn find(params: &Value) -> Result<Value, String> {
    let query = params.get("query").and_then(Value::as_str).ok_or("Missing query")?;
    if query.len() > 100 {
        return Err("Query too long".into());
    }
    let apps = installed();
    let found: Vec<Value> = rank(&apps, query)
        .into_iter()
        .take(5)
        .map(|(score, a)| json!({ "id": bare_id(&a.id), "name": a.name, "description": a.description, "score": score }))
        .collect();
    Ok(json!({ "apps": found }))
}

/// Resolve the app a `launch_app` request names, before asking the user about it.
pub fn resolve_for_launch(name: &str) -> Result<(String, String), String> {
    let apps = installed();
    let app = resolve(&apps, name)?;
    Ok((bare_id(&app.id), app.name.clone()))
}

/// Launch an already resolved desktop id. GIO sets the startup-notification / activation
/// environment and handles Terminal=true, Flatpak and D-Bus activatable apps.
pub fn launch(id: &str) -> Result<Value, String> {
    let desktop = gio::DesktopAppInfo::new(&format!("{id}.desktop")).ok_or_else(|| format!("Application '{id}' not found"))?;
    let ctx = gio::AppLaunchContext::new();
    desktop.launch(&[], Some(&ctx)).map_err(|e| format!("Could not launch {id}: {e}"))?;
    Ok(json!({ "name": id, "display_name": desktop.name().to_string(), "message": format!("Launched {}", desktop.name()) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str, generic: &str, kw: &[&str]) -> AppEntry {
        AppEntry { id: id.into(), name: name.into(), generic: generic.into(), keywords: kw.iter().map(|k| k.to_string()).collect(), ..Default::default() }
    }

    fn sample() -> Vec<AppEntry> {
        vec![
            app("org.mozilla.firefox.desktop", "Firefox", "Web Browser", &["internet", "www"]),
            app("org.kde.dolphin.desktop", "Dolphin", "File Manager", &["files", "explorer"]),
            app("org.gnome.Calculator.desktop", "Calculator", "Calculator", &[]),
            app("com.valvesoftware.Steam.desktop", "Steam", "Games", &["games"]),
            app("firefox-developer-edition.desktop", "Firefox Developer Edition", "Web Browser", &[]),
        ]
    }

    #[test]
    fn ranks_by_name_id_and_keywords() {
        let apps = sample();
        assert_eq!(rank(&apps, "firefox")[0].1.id, "org.mozilla.firefox.desktop");
        assert_eq!(rank(&apps, "file manager")[0].1.name, "Dolphin");
        assert_eq!(rank(&apps, "explorer")[0].1.name, "Dolphin");
        assert_eq!(rank(&apps, "calc")[0].1.name, "Calculator");
        assert!(rank(&apps, "zzz").is_empty());
        assert!(rank(&apps, "  ").is_empty());
    }

    #[test]
    fn every_word_has_to_match() {
        let apps = sample();
        assert!(rank(&apps, "firefox dolphin").is_empty());
        assert_eq!(rank(&apps, "web browser").len(), 2);
    }

    #[test]
    fn resolve_requires_an_unambiguous_exact_match() {
        let apps = sample();
        assert_eq!(resolve(&apps, "org.kde.dolphin").unwrap().name, "Dolphin");
        assert_eq!(resolve(&apps, "org.kde.dolphin.desktop").unwrap().name, "Dolphin");
        assert_eq!(resolve(&apps, "Steam").unwrap().id, "com.valvesoftware.Steam.desktop");
        assert_eq!(resolve(&apps, "calculator").unwrap().name, "Calculator");
        // "Firefox" is the exact name of one app; "Firefox Developer Edition" does not hijack it.
        assert_eq!(resolve(&apps, "firefox").unwrap().id, "org.mozilla.firefox.desktop");
    }

    #[test]
    fn resolve_never_guesses() {
        let apps = sample();
        let err = resolve(&apps, "fire").unwrap_err();
        assert!(err.contains("Did you mean") && err.contains("Firefox"));
        assert!(resolve(&apps, "zzz").unwrap_err().contains("find_apps"));
    }
}
