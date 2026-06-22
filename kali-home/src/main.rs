// Kali home — application entrypoint.
//
// This file is intentionally small. kali-home is a thin shell: it opens a
// native window, embeds the kali-web frontend in a webview, spawns the
// Python sidecar (kali-core), and registers a few Tauri commands for
// system-level actions that Python cannot do safely (screen capture,
// launching apps, file dialogs).
//
// If you do not know Rust yet: read this file top to bottom. Every block
// has a comment explaining what it does. You should not need to edit it
// often.

mod capture;
mod commands;
mod ipc;
mod sidecar;

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

    log::info!("kali-home starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_sidecar_port,
            commands::capture_backend,
            commands::capture_full,
            commands::list_monitors,
            commands::launch_app,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Start the IPC WS server for Python ↔ Rust communication.
            tauri::async_runtime::spawn(async move {
                ipc::serve().await;
            });
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sidecar::spawn_and_supervise(handle).await {
                    log::error!("sidecar error: {e}");
                }
            });

            // Allow microphone access in the WebKitGTK webview.
            // Without this, getUserMedia() fails with "not allowed by
            // the user agent" because nobody handles the permission
            // request signal that WebKitGTK emits.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|wv| {
                        use webkit2gtk::glib::ObjectExt;
                        use webkit2gtk::{PermissionRequestExt, UserMediaPermissionRequest, WebViewExt};
                        let wv = wv.inner();
                        wv.connect_permission_request(|_w, req| {
                            if req.is::<UserMediaPermissionRequest>() {
                                req.allow();
                                true
                            } else {
                                false
                            }
                        });
                    });
                }
            }

            log::info!("kali-home ready, webview will load kali-web");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running kali-home");
}