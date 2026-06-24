/**
 * workspace/usePersistence.ts — localStorage save/load for workspace state.
 *
 * Auto-saves window positions, sizes, and closed state every N seconds.
 * On mount, loads the previous workspace (if any) so the layout persists
 * across page refreshes.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { ArtifactWindowData } from "./types";

const STORAGE_KEY = "kali.workspace";
const SAVE_INTERVAL = 5000; // ms

interface PersistedWindow {
  id: number;
  type: string;
  title: string;
  icon: string;
  position: { x: number; y: number };
  size: { width: number; height: number | null };
  zIndex: number;
  closed: boolean;
  minimized: boolean;
}

export function usePersistence(windows: ArtifactWindowData[]) {
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Load on mount
  const load = useCallback((): PersistedWindow[] | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as PersistedWindow[];
    } catch {
      return null;
    }
  }, []);

  // Save
  const save = useCallback(() => {
    try {
      const data: PersistedWindow[] = windows
        .filter((w) => !w.closed)
        .map((w) => ({
          id: w.id,
          type: w.type,
          title: w.title,
          icon: w.icon,
          position: w.position,
          size: w.size,
          zIndex: w.zIndex,
          closed: w.closed,
          minimized: w.minimized,
        }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
  }, [windows]);

  // Auto-save every SAVE_INTERVAL
  useEffect(() => {
    if (!loaded) return;
    saveTimer.current = window.setInterval(save, SAVE_INTERVAL);
    return () => { if (saveTimer.current) clearInterval(saveTimer.current); };
  }, [save, loaded]);

  // Mark as loaded
  useEffect(() => { setLoaded(true); }, []);

  return { load, save, loaded };
}