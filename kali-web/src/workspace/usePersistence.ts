import { useCallback } from "react";
import type { ArtifactWindowData, Position, Size } from "./types";

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

export function usePersistence() {
  const getSavedState = useCallback((artifactId: string): WindowLayoutState | null => {
    const map = readMap();
    return map[artifactId] ?? null;
  }, []);

  const saveWindowState = useCallback((w: ArtifactWindowData) => {
    if (!w.artifactId) return;
    const map = readMap();
    map[w.artifactId] = {
      position: w.position,
      size: w.size,
      zIndex: w.zIndex,
      minimized: w.minimized,
      maximized: w.maximized,
      closed: w.closed,
    };
    writeMap(map);
  }, []);

  return { getSavedState, saveWindowState };
}