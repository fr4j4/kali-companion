/**
 * lib/canvasV2Pref.ts — "New canvas" switch (Settings → Appearance), on by default.
 *
 * Kept as a fallback to the previous canvas while the new one settles. Shared through
 * localStorage plus an in-page event so Settings and the stage stay in step.
 */

import { useCallback, useSyncExternalStore } from "react";

const KEY = "kali.canvasV2";
const EVENT = "kali:canvas-v2";

export function readCanvasV2(): boolean {
  try { return localStorage.getItem(KEY) !== "false"; } catch { return true; }
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener("storage", fn); };
}

export function useCanvasV2Pref(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(subscribe, readCanvasV2, () => true);
  const set = useCallback((v: boolean) => {
    try { localStorage.setItem(KEY, String(v)); } catch { /* storage blocked */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [value, set];
}

// ── Hub and Studio ──────────────────────────────────────

const START_MODE_KEY = "kali.v2.startMode";
const SUGGEST_KEY = "kali.v2.suggestStudio";

/** «Al abrir Kali»: the mode a session starts in (the Hub unless chosen otherwise). */
export function readStartMode(): "hub" | "studio" {
  try { return localStorage.getItem(START_MODE_KEY) === "studio" ? "studio" : "hub"; } catch { return "hub"; }
}

/** «Proponer el Estudio cuando llegue un segundo artefacto»: off unless switched on. */
export function readSuggestStudio(): boolean {
  try { return localStorage.getItem(SUGGEST_KEY) === "true"; } catch { return false; }
}

function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useStartModePref(): ["hub" | "studio", (v: "hub" | "studio") => void] {
  const value = useSyncExternalStore(subscribe, readStartMode, () => "hub" as const);
  return [value, useCallback((v: "hub" | "studio") => store(START_MODE_KEY, v), [])];
}

export function useSuggestStudioPref(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(subscribe, readSuggestStudio, () => false);
  return [value, useCallback((v: boolean) => store(SUGGEST_KEY, String(v)), [])];
}
