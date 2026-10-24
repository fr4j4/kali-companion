import { describe, it, expect } from "vitest";
import { findFreeSlot, type Rect } from "../placement";

const area: Rect = { x: 16, y: 72, w: 1000, h: 600 };

describe("findFreeSlot", () => {
  it("starts at the top-right corner of an empty area", () => {
    const pos = findFreeSlot({ w: 300, h: 200 }, area, []);
    expect(pos).toEqual({ x: 716, y: 72 });
  });

  it("never overlaps an existing window when there is room", () => {
    const first: Rect = { x: 716, y: 72, w: 300, h: 200 };
    const pos = findFreeSlot({ w: 300, h: 200 }, area, [first]);
    const cand = { x: pos.x, y: pos.y, w: 300, h: 200 };
    const overlaps = cand.x < first.x + first.w && cand.x + cand.w > first.x && cand.y < first.y + first.h && cand.y + cand.h > first.y;
    expect(overlaps).toBe(false);
  });

  it("keeps clear of the avatar obstacle", () => {
    const avatar: Rect = { x: 400, y: 100, w: 220, h: 220 };
    for (let i = 0; i < 4; i++) {
      const pos = findFreeSlot({ w: 280, h: 240 }, area, [avatar]);
      const hit = pos.x < avatar.x + avatar.w && pos.x + 280 > avatar.x && pos.y < avatar.y + avatar.h && pos.y + 240 > avatar.y;
      expect(hit).toBe(false);
    }
  });

  it("falls back to the least-overlapping spot when the area is full", () => {
    const wall: Rect = { x: 16, y: 72, w: 1000, h: 600 };
    const pos = findFreeSlot({ w: 300, h: 200 }, area, [wall]);
    expect(pos.x).toBeGreaterThanOrEqual(area.x);
    expect(pos.y).toBeGreaterThanOrEqual(area.y);
  });

  it("returns the area origin when the window is bigger than the area", () => {
    expect(findFreeSlot({ w: 2000, h: 200 }, area, [])).toEqual({ x: 16, y: 72 });
  });
});
