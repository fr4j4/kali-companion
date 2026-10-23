import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("kaliDesktop", {
  getConfig: () => ipcRenderer.invoke("desktop:get-config"),
  saveConfig: (config: { mode?: "local" | "remote"; backendUrl: string; token: string; capabilityToken: string }) => ipcRenderer.invoke("desktop:save-config", config),
  setKeepAlive: (value: boolean) => ipcRenderer.invoke("desktop:keep-alive", value),
  openMain: (hash?: string) => ipcRenderer.invoke("desktop:open-main", hash),
  showAvatar: (visible: boolean) => ipcRenderer.invoke("desktop:show-avatar", visible),
  setAvatarCorner: (corner: string) => ipcRenderer.invoke("desktop:set-avatar-corner", corner),
  setAvatarSize: (size: number) => ipcRenderer.invoke("desktop:set-avatar-size", size),
  setCaptureFeedback: (options: { thumbnail: boolean; sound: boolean }) => ipcRenderer.invoke("desktop:set-capture-feedback", options),
  onCapture: (callback: (state: { thumb: string | null; sound: boolean }) => void) => {
    const handler = (_event: unknown, state: { thumb: string | null; sound: boolean }) => callback(state);
    ipcRenderer.on("desktop:capture", handler);
    return () => ipcRenderer.removeListener("desktop:capture", handler);
  },
  setArtifactsNative: (value: boolean) => ipcRenderer.invoke("desktop:set-artifacts-native", value),
  getNativeArtifacts: () => ipcRenderer.invoke("desktop:native-artifacts"),
  returnArtifact: (sessionId: string, artifactId: string) => ipcRenderer.invoke("desktop:return-artifact", sessionId, artifactId),
  onArtifactNative: (callback: (state: { sessionId: string; id: string; open: boolean; returned: boolean }) => void) => {
    const handler = (_event: unknown, state: { sessionId: string; id: string; open: boolean; returned: boolean }) => callback(state);
    ipcRenderer.on("desktop:artifact-native", handler);
    return () => ipcRenderer.removeListener("desktop:artifact-native", handler);
  },
  openArtifact: (sessionId: string, artifactId: string) => ipcRenderer.invoke("desktop:open-artifact", sessionId, artifactId),
  performAction: (action: string, params: Record<string, unknown>) => ipcRenderer.invoke("desktop:action", action, params),
  setPresence: (state: { mood: string; emotion: string; text: string; connected: boolean }) => ipcRenderer.send("desktop:presence", state),
  onPresence: (callback: (state: { mood: string; emotion: string; text: string; connected: boolean }) => void) => {
    const handler = (_event: unknown, state: { mood: string; emotion: string; text: string; connected: boolean }) => callback(state);
    ipcRenderer.on("desktop:presence", handler);
    return () => ipcRenderer.removeListener("desktop:presence", handler);
  },
  onNavigate: (callback: (hash: string) => void) => {
    const handler = (_event: unknown, hash: string) => callback(hash);
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
});
