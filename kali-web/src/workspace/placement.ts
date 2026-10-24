/**
 * workspace/placement.ts — Free-space placement for new canvas windows.
 *
 * New windows used to cascade from a fixed point, so they piled on top of each other and of the
 * avatar. `findFreeSlot` scans the work area for the spot where the window overlaps the least with
 * what is already there, preferring the corner closest to the anchor. It is pure; the DOM-reading
 * glue lives in `measureStage`.
 */

import type { Position, WindowData } from "./types";

export interface Rect { x: number; y: number; w: number; h: number }

const STEP = 20;
/** Height assumed for auto-height windows that are not mounted yet. */
export const AUTO_HEIGHT_GUESS = 320;

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/**
 * Best top-left corner for a `size` window inside `area`, or the area's top-left when it cannot fit.
 * Candidates without any overlap win; among them (or among equally overlapping ones) the one nearest
 * the area's top-right corner is picked, so windows fill the side of the stage away from the avatar.
 */
export function findFreeSlot(
  size: { w: number; h: number },
  area: Rect,
  obstacles: Rect[],
  gap = 12,
): Position {
  const maxX = area.x + area.w - size.w;
  const maxY = area.y + area.h - size.h;
  if (maxX < area.x || maxY < area.y) return { x: Math.max(area.x, Math.min(area.x, maxX)), y: area.y };
  const padded = obstacles.map((o) => inflate(o, gap / 2));
  const anchor = { x: maxX, y: area.y };
  let best: Position = { x: maxX, y: area.y };
  let bestCost = Infinity;
  for (let y = area.y; y <= maxY + 0.5; y += STEP) {
    for (let x = maxX; x >= area.x - 0.5; x -= STEP) {
      const cand: Rect = { x, y, w: size.w, h: size.h };
      let overlap = 0;
      for (const o of padded) overlap += overlapArea(cand, o);
      const dist = Math.hypot(x - anchor.x, y - anchor.y);
      // Overlap dominates; distance only breaks ties (scaled so it never outweighs one px² of overlap).
      const cost = overlap * 1000 + dist;
      if (cost < bestCost) { bestCost = cost; best = { x, y }; if (cost === 0) return best; }
    }
  }
  return best;
}

const num = (v: string, fallback: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };

/** Work area and obstacles measured from the live stage (HUD, dock, docked chat, avatar, transcript). */
export function measureStage(windows: WindowData[]): { area: Rect; obstacles: Rect[] } {
  const root = getComputedStyle(document.documentElement);
  const density = num(root.getPropertyValue("--mul-density"), 1);
  const chatW = num(root.getPropertyValue("--chat-dock-w"), 0);
  const left = 16 * density;
  const top = 88 * density;
  const right = window.innerWidth - chatW - 16 * density;
  const dock = document.querySelector("footer.neural-dock") as HTMLElement | null;
  const bottom = dock ? Math.min(window.innerHeight - 24, dock.getBoundingClientRect().top - 12) : window.innerHeight - 110 * density;
  const area: Rect = { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  const obstacles: Rect[] = [];
  const fixed = [document.getElementById("avatar-container"), document.getElementById("stage-transcript"), ...Array.from(document.querySelectorAll("[data-neural-node]"))];
  for (const el of fixed) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) obstacles.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  for (const w of windows) {
    if (w.closed || w.minimized || w.maximized) continue;
    const el = document.querySelector(`[data-window-id="${w.id}"]`);
    const measured = el?.getBoundingClientRect();
    obstacles.push({
      x: w.position.x,
      y: w.position.y,
      w: measured?.width || w.size.width,
      h: measured?.height || w.size.height || AUTO_HEIGHT_GUESS,
    });
  }
  return { area, obstacles };
}
