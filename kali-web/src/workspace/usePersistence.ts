import { useCallback, useEffect, useRef } from "react";
import type { WindowData, Position, Size } from "./types";

const STORAGE_KEY = "kali.workspace";

export interface WindowLayoutState {
  position: Position;
  size: Size;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  closed: boolean;
}

type LayoutMap = Record<string, WindowLayoutState>;

function readMap(): LayoutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LayoutMap;
  } catch {
    return {};
  }
}

function writeMap(map: LayoutMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

const FLUSH_DELAY_MS = 400;

/**
 * Persistence hook with debounced writes.
 *
 * `saveWindowState` is called frequently during drag/resize (every
 * pointermove). Writing to localStorage synchronously on each call
 * blocks the main thread and causes visible jank. Instead, we
 * accumulate pending changes in an in-memory Map and flush them
 * with a setTimeout debounce — only the last state per artifactId
 * within the debounce window is written.
 *
 * A final flush also runs on `beforeunload` to avoid data loss.
 */
export function usePersistence() {
  // In-memory buffer of pending writes, keyed by artifactId.
  const pendingRef = useRef<Map<string, WindowLayoutState>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    const map = readMap();
    for (const [id, state] of pending) {
      map[id] = state;
    }
    writeMap(map);
    pending.clear();
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(flush, FLUSH_DELAY_MS);
  }, [flush]);

  // Final flush on unmount / page unload.
  useEffect(() => {
    const onBeforeUnload = () => flush();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      flush();
    };
  }, [flush]);

  const getSavedState = useCallback((artifactId: string): WindowLayoutState | null => {
    // Check pending buffer first (most recent state).
    const pending = pendingRef.current.get(artifactId);
    if (pending) return pending;
    const map = readMap();
    return map[artifactId] ?? null;
  }, []);

  const saveWindowState = useCallback((w: WindowData) => {
    if (!w.artifactId) return;
    pendingRef.current.set(w.artifactId, {
      position: w.position,
      size: w.size,
      zIndex: w.zIndex,
      minimized: w.minimized,
      maximized: w.maximized,
      closed: w.closed,
    });
    scheduleFlush();
  }, [scheduleFlush]);

  return { getSavedState, saveWindowState };
}