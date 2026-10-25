export interface DesktopConnectionConfig {
  backendUrl: string;
  token: string;
  capabilityToken: string;
  showAvatar: boolean;
  avatarSize: number;
}

export interface DesktopBridge {
  getConfig(): Promise<DesktopConnectionConfig>;
  saveConfig(config: { backendUrl: string; token: string; capabilityToken: string }): Promise<boolean>;
  openMain(hash?: string): Promise<void>;
  showAvatar(visible: boolean): Promise<void>;
  setAvatarSize(size: number): Promise<void>;
  openArtifact(sessionId: string, artifactId: string): Promise<void>;
  performAction(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  setPresence(state: { mood: string; emotion: string; text: string; connected: boolean }): void;
  onPresence(callback: (state: { mood: string; emotion: string; text: string; connected: boolean }) => void): () => void;
  onNavigate(callback: (hash: string) => void): () => void;
}

declare global { interface Window { kaliDesktop?: DesktopBridge } }

let desktopConfig: DesktopConnectionConfig | null = null;

export async function initializeDesktop(): Promise<DesktopConnectionConfig | null> {
  if (!window.kaliDesktop) return null;
  desktopConfig = await window.kaliDesktop.getConfig();
  return desktopConfig;
}

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
