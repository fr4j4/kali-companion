export interface DesktopConnectionConfig {
  backendUrl: string;
  token: string;
  capabilityToken: string;
  showAvatar: boolean;
  avatarSize: number;
  /** "local": the shell supervises a loopback kali-core; "remote": connect to backendUrl. */
  mode: "local" | "remote";
  /** True when the native avatar agent is running and owns the avatar, tray and native actions. */
  nativeAgent: boolean;
  /** Open every new artifact as its own native window instead of a canvas window. */
  artifactsNative: boolean;
  /** Show a thumbnail next to the avatar after a screen capture. */
  captureThumbnail: boolean;
  /** Play a shutter sound after a screen capture. */
  captureSound: boolean;
}

export interface DesktopPresence { frame: import("../avatar/rig/types").PresenceFrame | null; offset: number; connected: boolean; text: string }

export interface NativeArtifactRef { sessionId: string; id: string }

export interface DesktopBridge {
  getConfig(): Promise<DesktopConnectionConfig>;
  saveConfig(config: { mode?: "local" | "remote"; backendUrl: string; token: string; capabilityToken: string }): Promise<boolean>;
  /** Ask the shell to stay resident after its windows close (voice/wake word active). */
  setKeepAlive(value: boolean): Promise<void>;
  openMain(hash?: string): Promise<void>;
  showAvatar(visible: boolean): Promise<void>;
  setAvatarSize(size: number): Promise<void>;
  /** Screen corner the native avatar anchors to (layer-shell / X11). */
  setAvatarCorner(corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"): Promise<void>;
  setArtifactsNative(value: boolean): Promise<void>;
  setCaptureFeedback(options: { thumbnail: boolean; sound: boolean }): Promise<void>;
  /** Electron fallback avatar only: a capture was taken (thumb is null when the thumbnail is off). */
  onCapture?(callback: (state: { thumb: string | null; sound: boolean }) => void): () => void;
  /** Artifacts currently in native windows, and ones sent back to the canvas while the main window was away. */
  getNativeArtifacts(): Promise<{ open: NativeArtifactRef[]; returned: NativeArtifactRef[] }>;
  /** From a native artifact window: close it and restore the artifact in the canvas. */
  returnArtifact(sessionId: string, artifactId: string): Promise<void>;
  onArtifactNative(callback: (state: NativeArtifactRef & { open: boolean; returned: boolean }) => void): () => void;
  openArtifact(sessionId: string, artifactId: string): Promise<void>;
  performAction(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Latest presence frame (core `presence_state` v2) plus the clock offset and the assistant text tail. */
  setPresence(state: DesktopPresence): void;
  onPresence(callback: (state: DesktopPresence) => void): () => void;
  /** System dialog for a consent question; resolves to allow, allow_session or deny. */
  askConsent?(text: { title: string; detail: string; allow: string; allowSession: string; deny: string }): Promise<"allow" | "allow_session" | "deny">;
  onNavigate(callback: (hash: string) => void): () => void;
}

declare global { interface Window { kaliDesktop?: DesktopBridge } }

let desktopConfig: DesktopConnectionConfig | null = null;

export async function initializeDesktop(): Promise<DesktopConnectionConfig | null> {
  if (!window.kaliDesktop) return null;
  desktopConfig = await window.kaliDesktop.getConfig();
  return desktopConfig;
}

/** Persist the "artifacts as native windows" preference in the shell config and mirror it locally. */
export async function setArtifactsNative(value: boolean): Promise<void> {
  if (!window.kaliDesktop) return;
  await window.kaliDesktop.setArtifactsNative(value);
  if (desktopConfig) desktopConfig.artifactsNative = value;
}

export function artifactsNativeEnabled(): boolean { return isDesktop() && desktopConfig?.artifactsNative === true; }

export function isDesktop(): boolean { return !!window.kaliDesktop; }
export function getDesktopConfig(): DesktopConnectionConfig | null { return desktopConfig; }
export function getApiToken(): string {
  return desktopConfig?.token || (!isDesktop() ? localStorage.getItem("kali.apiToken") || "" : "");
}

export function websocketUrl(): string {
  if (desktopConfig?.backendUrl) {
    const url = new URL(desktopConfig.backendUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    return url.toString();
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}
