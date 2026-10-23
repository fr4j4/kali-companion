// Configuration shared between kali-shell (Electron) and kali-avatar (native agent).
//
// Both processes read ~/.config/kali/desktop.json (XDG_CONFIG_HOME aware). The
// file holds the API tokens, so it is created with mode 0600. Tokens are stored
// in plain text: the native agent has no access to Electron's safeStorage and
// must be able to connect while Electron is not running.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type AvatarCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface AvatarPrefs {
  visible: boolean;
  size: number;
  corner: AvatarCorner;
  monitor: string;
  showText: boolean;
  /** Dragged position in monitor pixels; absent means "use the corner". */
  x?: number;
  y?: number;
}

export interface SharedConfig {
  version: 1;
  /** "local": kali-shell supervises a kali-core on 127.0.0.1; "remote": connect to backendUrl. */
  mode: "local" | "remote";
  backendUrl: string;
  token: string;
  capabilityToken: string;
  avatar: AvatarPrefs;
}

export const AVATAR_SIZES = [160, 220, 300];

export function defaultConfig(): SharedConfig {
  return {
    version: 1,
    mode: "remote",
    backendUrl: "",
    token: "",
    capabilityToken: "",
    avatar: { visible: true, size: 220, corner: "bottom-right", monitor: "", showText: false },
  };
}

export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "kali");
}

export function configFile(): string {
  return join(configDir(), "desktop.json");
}

export function runtimeDir(): string {
  return join(process.env.XDG_RUNTIME_DIR || "/tmp", "kali");
}

/** Merge untrusted JSON over the defaults, keeping only well-formed fields. */
export function normalizeConfig(raw: unknown): SharedConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const av = (r.avatar && typeof r.avatar === "object" ? r.avatar : {}) as Record<string, unknown>;
  const corners: AvatarCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
  return {
    version: 1,
    mode: r.mode === "local" ? "local" : "remote",
    backendUrl: typeof r.backendUrl === "string" ? r.backendUrl : "",
    token: typeof r.token === "string" ? r.token : "",
    capabilityToken: typeof r.capabilityToken === "string" ? r.capabilityToken : "",
    avatar: {
      visible: av.visible !== false,
      size: AVATAR_SIZES.includes(av.size as number) ? (av.size as number) : base.avatar.size,
      corner: corners.includes(av.corner as AvatarCorner) ? (av.corner as AvatarCorner) : base.avatar.corner,
      monitor: typeof av.monitor === "string" ? av.monitor : "",
      showText: av.showText === true,
      ...(Number.isFinite(av.x) && Number.isFinite(av.y) ? { x: Math.round(av.x as number), y: Math.round(av.y as number) } : {}),
    },
  };
}

export function loadSharedConfig(): SharedConfig | null {
  try {
    return normalizeConfig(JSON.parse(readFileSync(configFile(), "utf8")));
  } catch {
    return null;
  }
}

export function saveSharedConfig(config: SharedConfig): void {
  const file = configFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

/** True while kali-avatar is alive (it keeps a pid file in the runtime dir). */
export function nativeAgentRunning(): boolean {
  try {
    const pidFile = join(runtimeDir(), "avatar.pid");
    if (!existsSync(pidFile)) return false;
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
