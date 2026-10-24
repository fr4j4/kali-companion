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
