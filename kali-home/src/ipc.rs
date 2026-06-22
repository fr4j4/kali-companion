// IPC WebSocket bridge — receives system_command messages from Python
// (kali-core / GazeClient), dispatches to the capture backend, and
// returns system_result responses over the same WS connection.
//
// Architecture:
//   Python GazeClient  ←→  WS  ←→  ipc::serve  ←→  capture_backend
//
// The server listens on a configurable port (default 8901, env
// KALI_HOME_IPC_PORT). The sidecar forwards this port to the Python
// process via environment variable.

use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

type SharedState = Arc<Mutex<()>>;

/// Start the IPC server in the background.
pub async fn serve() {
    let port = std::env::var("KALI_HOME_IPC_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(8901);

    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => {
            log::info!("IPC WS server listening on ws://{addr}");
            l
        }
        Err(e) => {
            log::error!("IPC WS server failed to bind: {e}");
            return;
        }
    };

    let state: SharedState = Arc::new(Mutex::new(()));

    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(conn) => conn,
            Err(e) => {
                log::error!("IPC accept error: {e}");
                continue;
            }
        };

        let state = state.clone();
        tokio::spawn(async move {
            log::info!("IPC client connected: {peer}");
            if let Err(e) = handle_connection(stream, state).await {
                log::error!("IPC connection error ({peer}): {e}");
            }
            log::info!("IPC client disconnected: {peer}");
        });
    }
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    _state: SharedState,
) -> Result<(), String> {
    let mut ws = accept_async(stream)
        .await
        .map_err(|e| format!("WS handshake failed: {e}"))?;

    loop {
        let msg = match ws.next().await {
            Some(Ok(m)) => m,
            Some(Err(e)) => return Err(format!("WS recv error: {e}")),
            None => return Ok(()), // clean close
        };

        if msg.is_close() {
            return Ok(());
        }

        let response = if msg.is_text() || msg.is_binary() {
            let text = msg.to_text().unwrap_or("");
            handle_message(text).await
        } else {
            continue;
        };

        let response_json = serde_json::to_string(&response)
            .unwrap_or_else(|_| r#"{"error":"serialization_failed"}"#.into());

        ws.send(Message::Text(response_json.into()))
            .await
            .map_err(|e| format!("WS send error: {e}"))?;
    }
}

/// Message dispatch — parse the command and execute.
async fn handle_message(text: &str) -> serde_json::Value {
    let cmd: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => {
            return serde_json::json!({
                "error": format!("invalid JSON: {e}")
            });
        }
    };

    let command = cmd.get("command").and_then(|v| v.as_str()).unwrap_or("");

    match command {
        "capture_full" => {
            let output = cmd.get("output").and_then(|v| v.as_str());
            handle_capture_full(output).await
        }
        "list_monitors" => handle_list_monitors().await,
        "ping" => serde_json::json!({"result": "pong"}),
        _ => serde_json::json!({
            "error": format!("unknown command: {command}")
        }),
    }
}

async fn handle_list_monitors() -> serde_json::Value {
    match crate::capture::list_monitors().await {
        Ok(monitors_json) => serde_json::json!({ "result": { "monitors": monitors_json } }),
        Err(e) => serde_json::json!({ "error": e }),
    }
}

async fn handle_capture_full(output: Option<&str>) -> serde_json::Value {
    match crate::capture::capture_full(output).await {
        Ok(png_bytes) => {
            let b64 = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &png_bytes,
            );
            serde_json::json!({
                "result": {
                    "data": b64,
                    "mime": "image/png",
                    "size": png_bytes.len(),
                }
            })
        }
        Err(e) => serde_json::json!({"error": e}),
    }
}
