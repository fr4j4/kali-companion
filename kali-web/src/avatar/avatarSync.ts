/**
 * avatar/avatarSync.ts — Keeps the avatar appearance identical across the canvas, the
 * Electron floating avatar and the native agent.
 *
 * The core stores one config (`avatar_config` event, see kali-core/avatar_config.py). The main
 * window mirrors it into localStorage, which the Electron avatar window (same origin) watches;
 * the native agent receives the same event straight from its own presence socket.
 */

import { loadAvatarConfig, mergeAvatarConfig, saveAvatarConfig, hasStoredAvatarConfig, AVATAR_CONFIG_STORAGE_KEY, type AvatarConfig } from "./avatarConfig";

export const AVATAR_CONFIG_EVENT = "kali:avatar-config";

interface WsLike { send(payload: Record<string, unknown>): void }

/**
 * Handle a core `avatar_config` frame. A real config is stored locally and announced to the UI;
 * `null` means the core has none yet, so a device that already customized the avatar seeds it.
 */
export function handleRemoteAvatarConfig(config: unknown, client: WsLike | null): void {
  if (config && typeof config === "object") {
    const merged = mergeAvatarConfig(config);
    if (JSON.stringify(merged) === JSON.stringify(loadAvatarConfig()) && hasStoredAvatarConfig()) return;
    saveAvatarConfig(merged);
    window.dispatchEvent(new CustomEvent<AvatarConfig>(AVATAR_CONFIG_EVENT, { detail: merged }));
  } else if (hasStoredAvatarConfig()) {
    publishAvatarConfig(client, loadAvatarConfig());
  }
}

/** Ask the core to adopt (and broadcast) this appearance. */
export function publishAvatarConfig(client: WsLike | null, config: AvatarConfig): void {
  client?.send({ event: "avatar_config_set", config });
}

/** Subscribe to appearance changes made anywhere (this window, another window, the core). */
export function subscribeAvatarConfig(onChange: (config: AvatarConfig) => void): () => void {
  const onEvent = (e: Event) => onChange((e as CustomEvent<AvatarConfig>).detail);
  const onStorage = (e: StorageEvent) => { if (e.key === AVATAR_CONFIG_STORAGE_KEY || e.key === null) onChange(loadAvatarConfig()); };
  window.addEventListener(AVATAR_CONFIG_EVENT, onEvent);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(AVATAR_CONFIG_EVENT, onEvent); window.removeEventListener("storage", onStorage); };
}
