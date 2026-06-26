// kali-shell/src/preload.ts
//
// Exposes a minimal API to the renderer via contextBridge. The frontend
// uses window.kali.getSidecarPort() to learn which port the Python
// sidecar is listening on (replaces window.__TAURI__.core.invoke).

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kali", {
  getSidecarPort: (): Promise<number> => ipcRenderer.invoke("get-sidecar-port"),
});