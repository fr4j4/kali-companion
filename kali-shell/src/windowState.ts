// Remembers the size and position of native artifact windows between sessions.
// Kept in userData (not the shared token file): it is purely cosmetic.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Bounds { width: number; height: number; x?: number; y?: number }
export interface Rect { x: number; y: number; width: number; height: number }

const DEFAULT_BOUNDS: Bounds = { width: 850, height: 650 };

/** Keep only well-formed numbers and drop the position when it would land off every display. */
export function sanitizeBounds(raw: unknown, displays: Rect[]): Bounds {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BOUNDS };
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), min), max) : undefined;
  const width = num(r.width, 400, 8000) ?? DEFAULT_BOUNDS.width;
  const height = num(r.height, 300, 8000) ?? DEFAULT_BOUNDS.height;
  const x = num(r.x, -20000, 20000);
  const y = num(r.y, -20000, 20000);
  if (x === undefined || y === undefined) return { width, height };
  // The title bar corner must be reachable on some display.
  const visible = displays.some((d) => x + 80 > d.x && x < d.x + d.width - 80 && y >= d.y - 10 && y < d.y + d.height - 40);
  return visible ? { width, height, x, y } : { width, height };
}

export function loadBounds(file: string, displays: Rect[]): Bounds {
  try {
    return existsSync(file) ? sanitizeBounds(JSON.parse(readFileSync(file, "utf8")), displays) : { ...DEFAULT_BOUNDS };
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}

export function saveBounds(file: string, bounds: Bounds): void {
  try { writeFileSync(file, JSON.stringify(bounds)); } catch { /* cosmetic: ignore read-only dirs */ }
}
