import { describe, expect, it } from "vitest";
import {
  CARD_GAP, CARD_H, CARD_W, NEW_ZONE, ZONE_GAP, ZONE_HEAD, ZONE_PAD, ZOOM_MAX, ZOOM_MIN,
  boardLayout, fitBoard, zoneAt, zoneGrid, zoomAround,
} from "../boardLayout";

describe("zoneGrid", () => {
  it("keeps room for one card when empty and caps at three columns", () => {
    expect(zoneGrid(0)).toEqual({ cols: 1, rows: 1 });
    expect(zoneGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(zoneGrid(4)).toEqual({ cols: 3, rows: 2 });
  });
});

describe("boardLayout", () => {
  it("lays zones left to right and ends with the new-group zone", () => {
    const l = boardLayout([{ id: "a", cardIds: [1, 2, 3, 4] }, { id: "b", cardIds: [5] }]);
    expect(l.zones.map((z) => z.id)).toEqual(["a", "b", NEW_ZONE]);
    const [a, b] = l.zones;
    expect(a.rect).toEqual({ x: 0, y: 0, w: ZONE_PAD * 2 + 3 * CARD_W + 2 * CARD_GAP, h: ZONE_HEAD + ZONE_PAD + 2 * CARD_H + CARD_GAP });
    expect(b.rect.x).toBe(a.rect.w + ZONE_GAP);
    // The fourth card wraps to the second row of its zone.
    expect(a.cards[3].rect).toEqual({ x: ZONE_PAD, y: ZONE_HEAD + CARD_H + CARD_GAP, w: CARD_W, h: CARD_H });
    expect(l.size.h).toBe(a.rect.h);
  });

  it("wraps zones to a new row past the maximum width", () => {
    const l = boardLayout([{ id: "a", cardIds: [1, 2, 3] }, { id: "b", cardIds: [4, 5, 6] }], 1200);
    expect(l.zones[1].rect.x).toBe(0);
    expect(l.zones[1].rect.y).toBe(l.zones[0].rect.h + ZONE_GAP);
  });
});

describe("zoneAt", () => {
  it("finds the zone under a world point", () => {
    const l = boardLayout([{ id: "a", cardIds: [1] }, { id: "b", cardIds: [2] }]);
    const b = l.zones[1].rect;
    expect(zoneAt(l, b.x + 5, b.y + 5)?.id).toBe("b");
    expect(zoneAt(l, -10, -10)).toBeUndefined();
  });
});

describe("fitBoard and zoomAround", () => {
  it("fits the board without going above 100 %", () => {
    expect(fitBoard({ w: 400, h: 300 }, { w: 1200, h: 800 }).zoom).toBe(ZOOM_MAX);
    const f = fitBoard({ w: 4000, h: 1000 }, { w: 1080, h: 800 });
    expect(f.zoom).toBeCloseTo(0.25);
    expect(fitBoard({ w: 40000, h: 1000 }, { w: 1000, h: 800 }).zoom).toBe(ZOOM_MIN);
  });

  it("keeps the point under the cursor fixed and clamps", () => {
    const v = { zoom: 0.5, x: 100, y: 50 };
    const n = zoomAround(v, 1.5, 400, 300);
    const before = { x: (400 - v.x) / v.zoom, y: (300 - v.y) / v.zoom };
    const after = { x: (400 - n.x) / n.zoom, y: (300 - n.y) / n.zoom };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAround(v, 10, 0, 0).zoom).toBe(ZOOM_MAX);
    expect(zoomAround(v, 0.01, 0, 0).zoom).toBe(ZOOM_MIN);
  });
});
