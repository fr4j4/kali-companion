/**
 * avatar/avatarPrefs.ts — Performance profile and reduced-motion preference, shared by every view.
 *
 * Both are mirrored on <html> (`data-perf-profile`, `data-reduced-motion`), so the canvas, the
 * Electron floating avatar and the native agent's WebView all follow the same mechanism; a
 * MutationObserver lets the rig react when either changes.
 */

import type { PerfProfileId } from "./avatarCatalog.gen";

export type MotionPref = "system" | "always" | "never";
export const MOTION_PREF_KEY = "kali.motion";

export function loadMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(MOTION_PREF_KEY);
    return v === "always" || v === "never" ? v : "system";
  } catch {
    return "system";
  }
}

export function saveMotionPref(pref: MotionPref): void {
  try { localStorage.setItem(MOTION_PREF_KEY, pref); } catch { /* storage unavailable */ }
  applyMotionPref(pref);
}

export function systemPrefersReducedMotion(): boolean {
  try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { return false; }
}

export function resolveReducedMotion(pref: MotionPref = loadMotionPref()): boolean {
  return pref === "always" ? true : pref === "never" ? false : systemPrefersReducedMotion();
}

/** Mirror the resolved preference on <html>; returns a cleanup that stops following the OS setting. */
export function applyMotionPref(pref: MotionPref = loadMotionPref(), root: HTMLElement = document.documentElement): () => void {
  const set = () => root.setAttribute("data-reduced-motion", String(resolveReducedMotion(pref)));
  set();
  let media: MediaQueryList | undefined;
  try { media = window.matchMedia?.("(prefers-reduced-motion: reduce)"); } catch { media = undefined; }
  media?.addEventListener?.("change", set);
  return () => media?.removeEventListener?.("change", set);
}

export interface AvatarPrefs { perf: PerfProfileId; reduced: boolean }

export function readAvatarPrefs(root: HTMLElement = document.documentElement): AvatarPrefs {
  const p = root.getAttribute("data-perf-profile");
  const perf: PerfProfileId = p === "performance" || p === "quality" ? p : "balanced";
  const attr = root.getAttribute("data-reduced-motion");
  return { perf, reduced: attr === null ? systemPrefersReducedMotion() : attr === "true" };
}

export function observeAvatarPrefs(cb: (prefs: AvatarPrefs) => void, root: HTMLElement = document.documentElement): () => void {
  const observer = new MutationObserver(() => cb(readAvatarPrefs(root)));
  observer.observe(root, { attributes: true, attributeFilter: ["data-perf-profile", "data-reduced-motion"] });
  return () => observer.disconnect();
}
