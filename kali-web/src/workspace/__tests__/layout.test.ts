import { describe, expect, it } from "vitest";
import { autoScale, cascadeSlots, computeLayout, defaultPreset, isCompactPanel, mosaicLayout } from "../layout";

const base = { w: 1440, h: 900 };

describe("autoScale", () => {
  it("is 1 at the design size and clamps between 0.8 and 1.33", () => {
    expect(autoScale(1440, 900)).toBe(1);
    expect(autoScale(800, 500)).toBe(0.8);
    expect(autoScale(3840, 2160)).toBe(1.33);
    expect(autoScale(1920, 1080)).toBe(1.2);
  });
  it("applies the manual adjustment on top", () => {
    expect(autoScale(1440, 900, 1.1)).toBe(1.1);
  });
});

describe("computeLayout", () => {
  it("shows the stage when nothing is open, whatever the group mode", () => {
    const l = computeLayout({ mode: "focus", stage: base, visibleWindows: 0 });
    expect(l.mode).toBe("stage");
    expect(l.artifact).toBeNull();
    expect(l.mapCenter).toEqual({ x: 720, y: 360 });
    expect(l.dock).toEqual({ x: 400, y: 823, w: 640, h: 52 });
  });

  it("matches the design's split geometry at 1440 × 900", () => {
    const l = computeLayout({ mode: "split", stage: base, visibleWindows: 2 });
    expect(l.mode).toBe("split");
    expect(l.artifact).toEqual({ x: 20, y: 56, w: 820, h: 610 });
    expect(l.kali).toEqual({ x: 860, y: 56, w: 560, h: 548 });
    expect(l.inspector).toEqual({ x: 860, y: 604, w: 560, h: 62 });
    // The avatar is the centre of the map.
    expect(l.mapCenter).toEqual({ x: 1140, y: 330 });
    expect(l.mapDensity).toBe("compact");
  });

  it("puts Kali in a 300 px column in focus and mosaic", () => {
    for (const mode of ["focus", "mosaic"] as const) {
      const l = computeLayout({ mode, stage: base, visibleWindows: 1 });
      expect(l.column).toEqual({ x: 1140, y: 0, w: 300, h: 900 });
      expect(l.rail?.w).toBe(56);
      expect(l.artifact).toEqual({ x: 70, y: 52, w: 1056, h: 834 });
      expect(l.mapCenter?.x).toBe(1290);
      expect(l.mapDensity).toBe("mini");
    }
  });

  it("reduces Kali to a bubble in fullscreen", () => {
    const l = computeLayout({ mode: "fullscreen", stage: base, visibleWindows: 1 });
    expect(l.artifact).toEqual({ x: 0, y: 0, w: 1440, h: 900 });
    expect(l.bubble).toEqual({ x: 1352, y: 812, w: 64, h: 64 });
    expect(l.kali).toBeNull();
  });

  it("goes to focus with a bubble below 1152 × 720 and never shows a mosaic", () => {
    const small = { w: 1100, h: 700 };
    for (const mode of ["split", "mosaic", "focus"] as const) {
      const l = computeLayout({ mode, stage: small, visibleWindows: 3 });
      expect(l.compact).toBe(true);
      expect(l.mode).toBe("focus");
      expect(l.column).toBeNull();
      expect(l.bubble).not.toBeNull();
    }
  });

  it("scales every rectangle with the window", () => {
    const l = computeLayout({ mode: "split", stage: { w: 1920, h: 1200 }, visibleWindows: 1 });
    expect(l.k).toBe(1.33);
    expect(l.dock?.w).toBe(Math.round(640 * 1.33));
  });

  it("shows a zone panel (tray, overview) in the split layout", () => {
    const l = computeLayout({ mode: "focus", stage: base, visibleWindows: 0, zonePanel: true });
    expect(l.mode).toBe("split");
    expect(l.artifact).not.toBeNull();
  });

  it("keeps a mini map with the avatar on top of the conversation view", () => {
    const l = computeLayout({ mode: "split", stage: base, visibleWindows: 1, kaliView: "conversation" });
    expect(l.map?.h).toBe(180);
    expect(l.mapCenter).toEqual({ x: 1140, y: 146 });
    expect(l.mapDensity).toBe("mini");
  });
});

describe("cascadeSlots", () => {
  const zone = { x: 20, y: 56, w: 820, h: 610 };
  it("fills the zone with one window and cascades up to three", () => {
    expect(cascadeSlots(zone, 1)).toEqual([zone]);
    const three = cascadeSlots(zone, 3);
    expect(three).toHaveLength(3);
    for (const s of three) {
      expect(s.x).toBeGreaterThanOrEqual(zone.x);
      expect(s.y).toBeGreaterThanOrEqual(zone.y);
      expect(s.x + s.w).toBeLessThanOrEqual(zone.x + zone.w + 1);
      expect(s.y + s.h).toBeLessThanOrEqual(zone.y + zone.h + 1);
    }
  });
  it("puts two windows side by side on wide screens", () => {
    const [a, b] = cascadeSlots({ x: 0, y: 0, w: 1212, h: 800 }, 2, true);
    expect(a.y).toBe(b.y);
    expect(a.x + a.w).toBeLessThan(b.x);
  });
});

describe("mosaicLayout", () => {
  const area = { x: 70, y: 52, w: 1056, h: 834 };
  it("picks a preset by window count", () => {
    expect([1, 2, 3, 4, 7].map(defaultPreset)).toEqual(["1", "2c", "1+2", "2x2", "2x2"]);
  });
  it("splits the area without overlaps and leaves the gap for the divider", () => {
    const m = mosaicLayout(area, "1+2", { a: 0.55, b: 0.5 });
    expect(m.panels).toHaveLength(3);
    expect(m.dividers.map((d) => d.orientation)).toEqual(["vertical", "horizontal"]);
    const [left, top, bottom] = m.panels;
    expect(left.x + left.w + 12).toBe(top.x);
    expect(top.y + top.h + 12).toBe(bottom.y);
  });
  it("never lets a panel go under 320 × 240", () => {
    const m = mosaicLayout(area, "2c", { a: 0.05, b: 0.5 });
    expect(Math.min(...m.panels.map((p) => p.w))).toBeGreaterThanOrEqual(320);
    const rows = mosaicLayout(area, "2x2", { a: 0.5, b: 0.99 });
    expect(Math.min(...rows.panels.map((p) => p.h))).toBeGreaterThanOrEqual(240);
  });
  it("flags small panels for the compact view", () => {
    expect(isCompactPanel({ x: 0, y: 0, w: 330, h: 260 })).toBe(true);
    expect(isCompactPanel({ x: 0, y: 0, w: 600, h: 400 })).toBe(false);
  });
});
