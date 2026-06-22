// Wayland screen capture via xdg-desktop-portal (ashpd).
//
// Uses the org.freedesktop.portal.Screenshot D-Bus API via ashpd.
// The portal saves the screenshot to a temp file and returns the URI.
// We read the file and encode as PNG bytes.

use std::fs;
use std::path::PathBuf;

/// Capture the full screen on Wayland. Returns PNG bytes.
pub async fn capture_via_portal() -> Result<Vec<u8>, String> {
    let uri = request_screenshot().await?;
    let path = uri_to_path(&uri)?;
    let bytes = fs::read(&path).map_err(|e| format!("failed to read screenshot: {e}"))?;
    // Clean up temp file.
    let _ = fs::remove_file(&path);
    Ok(bytes)
}

/// Request a screenshot via xdg-desktop-portal.
async fn request_screenshot() -> Result<String, String> {
    match ashpd::desktop::screenshot::ScreenshotRequest::default()
        .interactive(false)
        .send()
        .await
    {
        Ok(response) => {
            let screenshot = response.response()
                .map_err(|e| format!("portal response error: {e}"))?;
            let uri = screenshot.uri();
            Ok(uri.to_string())
        }
        Err(e) => Err(format!("ashpd screenshot failed: {e}")),
    }
}

/// Convert a `file://` URI to a filesystem path.
fn uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let path_str = uri
        .strip_prefix("file://")
        .ok_or_else(|| format!("expected file:// URI, got: {uri}"))?;
    // URL-decode percent-encoded characters.
    let decoded = urlencoding::decode(path_str)
        .map_err(|e| format!("failed to decode URI path: {e}"))?;
    Ok(PathBuf::from(decoded.as_ref()))
}
