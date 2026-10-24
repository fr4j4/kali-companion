/**
 * stage/v2/boardLayout.ts — Where the board puts each group and each card (pure).
 *
 *   ┌ ● Portada ─────────────────────────┐  ┌ ● Informe ───────────┐  ┌╌╌╌╌╌╌╌╌╌╌╌┐
 *   │ [card] [card] [card]               │  │ [card]               │  ╎ + new group ╎
 *   │ [card]                             │  └──────────────────────┘  └╌╌╌╌╌╌╌╌╌╌╌┘
 *   └────────────────────────────────────┘
 *
 * The board is a world in design units that the view zooms and pans: every group is a zone with
 * its name and a grid of 320 × 220 cards (up to three per row), zones flow left to right and wrap
 * at `maxRowW`, and a last dashed zone takes cards dropped there into a new group.
 */

import type { Rect } from "../../workspace/layout";

export const CARD_W = 320;
export const CARD_H = 220;
export const CARD_GAP = 20;
export const ZONE_PAD = 20;
export const ZONE_HEAD = 44;
export const ZONE_GAP = 40;
export const ZONE_COLS = 3;
export const NEW_ZONE = "new";

export interface BoardGroupIn { id: string; cardIds: number[] }
export interface BoardZone { id: string; rect: Rect; cards: { id: number; rect: Rect }[] }
export interface BoardLayout { zones: BoardZone[]; size: { w: number; h: number } }

/** Columns and rows of a zone with `n` cards (an empty zone keeps room for one). */
export function zoneGrid(n: number, cols = ZONE_COLS): { cols: number; rows: number } {
  const c = Math.max(1, Math.min(cols, n));
  return { cols: c, rows: Math.max(1, Math.ceil(n / c)) };
}

export function boardLayout(groups: BoardGroupIn[], maxRowW = 2400): BoardLayout {
  const zones: BoardZone[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  const place = (id: string, cardIds: number[]) => {
    const { cols, rows } = zoneGrid(cardIds.length);
    const w = ZONE_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP;
    const h = ZONE_HEAD + ZONE_PAD + rows * CARD_H + (rows - 1) * CARD_GAP;
    if (x > 0 && x + w > maxRowW) { x = 0; y += rowH + ZONE_GAP; rowH = 0; }
    const rect = { x, y, w, h };
    const cards = cardIds.map((cid, i) => ({
      id: cid,
      rect: { x: x + ZONE_PAD + (i % cols) * (CARD_W + CARD_GAP), y: y + ZONE_HEAD + Math.floor(i / cols) * (CARD_H + CARD_GAP), w: CARD_W, h: CARD_H },
    }));
    zones.push({ id, rect, cards });
    x += w + ZONE_GAP;
    rowH = Math.max(rowH, h);
    width = Math.max(width, rect.x + rect.w);
  };
  for (const g of groups) place(g.id, g.cardIds);
  place(NEW_ZONE, []);
  return { zones, size: { w: width, h: y + rowH } };
}

/** The zone under a point of the world, if any. */
export function zoneAt(layout: BoardLayout, x: number, y: number): BoardZone | undefined {
  return layout.zones.find((z) => x >= z.rect.x && x <= z.rect.x + z.rect.w && y >= z.rect.y && y <= z.rect.y + z.rect.h);
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 1;

/** The zoom and offset that fit the whole board in a viewport (never above 100 %). */
export function fitBoard(size: { w: number; h: number }, view: { w: number; h: number }, pad = 40): { zoom: number; x: number; y: number } {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (view.w - pad * 2) / Math.max(1, size.w), (view.h - pad * 2) / Math.max(1, size.h)));
  return { zoom, x: Math.max(pad, (view.w - size.w * zoom) / 2), y: pad };
}

/** Zoom by `factor` keeping the world point under (cx, cy) where it is. */
export function zoomAround(v: { zoom: number; x: number; y: number }, factor: number, cx: number, cy: number) {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor));
  const k = zoom / v.zoom;
  return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
}
