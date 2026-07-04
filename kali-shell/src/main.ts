// kali-shell/src/main.ts
//
// Electron main process — creates the Kali window, spawns and supervises
// the Python sidecar (kali-core), and loads the kali-web frontend.
//
// Ported from kali-home/src/main.rs + sidecar.rs. The key differences
// from the Tauri shell:
//   - No IPC WebSocket on :8901 (capture moved to Python via mss).
//   - Chromium handles Wayland/GPU natively — no WEBKIT_DISABLE_*
//     env workarounds needed.
//   - Microphone permission is granted via a session permission
//     handler instead of the WebKitGTK UserMediaPermissionRequest signal.

import { app, BrowserWindow, ipcMain, session } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { superviseSidecar, sidecarPort, waitForPort } from "./sidecar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let win: BrowserWindow | null = null;
let sidecar: ReturnType<typeof superviseSidecar> | null = null;

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    title: "Kali — AI Companion",
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Auto-allow microphone (getUserMedia). WebKitGTK needed a custom
  // permission handler; Chromium uses the session permission API.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      callback(permission === "media");
    },
  );

  // Block window.open() / target="_blank" from sandboxed artifact iframes.
  // Without this, an artifact calling window.open() (allowed by the
  // sandbox="allow-popups" flag) spawns a native Electron window, whose
  // focus/blur cycle triggers a content-visibility:auto re-measure of
  // sibling windows and visibly misaligns the Kali UI.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  return window;
}

app.whenReady().then(async () => {
  const port = sidecarPort();
  console.log(`[kali-shell] sidecar WS will listen on 127.0.0.1:${port}`);

  // Register the IPC handler so the renderer can ask for the sidecar port.
  ipcMain.handle("get-sidecar-port", () => port);

  // Start the sidecar supervisor.
  sidecar = superviseSidecar(port);

  // Wait (up to 10s) for the sidecar WS to be listening before loading
  // the frontend, so the first render has a backend to talk to.
  const ready = await waitForPort(port, 10000);
  if (!ready) {
    console.warn("[kali-shell] sidecar WS not ready after 10s; loading anyway");
  }

  win = await createWindow();
  win.loadURL("http://localhost:5173");
});

app.on("window-all-closed", () => {
  sidecar?.stop();
  app.quit();
});

app.on("before-quit", () => {
  sidecar?.stop();
});