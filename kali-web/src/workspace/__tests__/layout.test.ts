import { describe, expect, it } from "vitest";
import { autoScale, computeLayout, isCompactPanel } from "../layout";

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
  it("shows the stage when nothing is open", () => {
    const l = computeLayout({ stage: base, visibleWindows: 0 });
    expect(l.mode).toBe("stage");
    expect(l.artifact).toBeNull();
    expect(l.mapCenter).toEqual({ x: 720, y: 360 });
    expect(l.dock).toEqual({ x: 400, y: 823, w: 640, h: 52 });
    // The Hub · Studio switch top right, the windows pill under it.
    expect(l.modeSwitch).toEqual({ x: 1420, y: 14 });
    expect(l.windowsPill!.y).toBeGreaterThan(l.modeSwitch!.y);
  });

  it("scales every rectangle with the window", () => {
    const l = computeLayout({ stage: { w: 1920, h: 1200 }, visibleWindows: 0 });
    expect(l.k).toBe(1.33);
    expect(l.dock?.w).toBe(Math.round(640 * 1.33));
  });

  it("flags small panes for the compact view", () => {
    expect(isCompactPanel({ x: 0, y: 0, w: 330, h: 260 })).toBe(true);
    expect(isCompactPanel({ x: 0, y: 0, w: 600, h: 400 })).toBe(false);
  });
});

describe("computeLayout · Hub", () => {
  const hub = (state: "escucha" | "lamina" | "explorar" | "hilo", w = 1440, h = 900, cards = 0, current = true) =>
    computeLayout({ stage: { w, h }, visibleWindows: current ? 1 : 0, hub: state, hubCards: cards });
  const inside = (r: { x: number; y: number; w: number; h: number }, w: number, h: number) =>
    r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5;

  it("Escucha is the stage, with the cards above the dock and the switch top right", () => {
    const none = hub("escucha", 1440, 900, 0, false);
    expect(none.mode).toBe("stage");
    expect(none.fichas).toBeNull();
    expect(none.modeSwitch).not.toBeNull();
    expect(none.windowsPill).toBeNull();
    const l = hub("escucha", 1440, 900, 2, false);
    expect(l.fichas).not.toBeNull();
    expect(l.fichas!.y + l.fichas!.h).toBeLessThanOrEqual(l.dock!.y);
    expect(l.voice!.y + l.voice!.h).toBeLessThanOrEqual(l.fichas!.y);
  });

  it("a lámina without a window is Escucha", () => {
    expect(hub("lamina", 1440, 900, 0, false).mode).toBe("stage");
  });

  for (const [w, h] of [[1440, 900], [1920, 1080]]) {
    it(`Lámina at ${w}×${h}: Kali's panel left, the artifact right, the avatar in the panel's slot`, () => {
      const l = hub("lamina", w, h);
      expect(l.mode).toBe("hub");
      expect(l.column!.x).toBeLessThan(l.lamina!.x);
      expect(l.column!.x + l.column!.w).toBeLessThan(l.lamina!.x);
      expect(inside(l.lamina!, w, h)).toBe(true);
      expect(l.bubble).toBeNull();
      const c = l.mapCenter!;
      expect(c.x).toBeGreaterThan(l.column!.x);
      expect(c.x).toBeLessThan(l.column!.x + 120 * l.k);
      expect(l.avatar).toBeCloseTo(72 * l.k, 0);
    });
  }

  it("Explorar: the artifact takes the screen and Kali is a bubble", () => {
    const l = hub("explorar");
    expect(l.lamina).toEqual({ x: 0, y: 0, w: 1440, h: 900 });
    expect(l.bubble).not.toBeNull();
    expect(l.column).toBeNull();
    expect(l.mapCenter!.x).toBeCloseTo(l.bubble!.x + l.bubble!.w / 2);
  });

  it("Hilo: a centred reading column with the avatar in its header", () => {
    const l = hub("hilo");
    expect(l.thread!.w).toBe(680);
    expect(l.thread!.x).toBe((1440 - 680) / 2);
    expect(l.lamina).toBeNull();
    expect(l.avatar).toBe(56);
    expect(l.mapCenter!.y).toBeLessThan(l.thread!.y + 80);
  });

  it("a small window shows the lámina wide, with a strip for notices, cards and the bubble", () => {
    const l = hub("lamina", 1152, 700, 3);
    expect(l.compact).toBe(true);
    expect(l.column).toBeNull();
    expect(l.bubble).not.toBeNull();
    expect(l.lamina!.y + l.lamina!.h).toBeLessThanOrEqual(l.bubble!.y);
    expect(l.fichas).not.toBeNull();
    expect(l.fichas!.x + l.fichas!.w).toBeLessThanOrEqual(l.bubble!.x);
    expect(inside(l.lamina!, 1152, 700)).toBe(true);
  });
});

describe("computeLayout · Studio", () => {
  const studio = (w: number, h: number, groups = 1) => computeLayout({ stage: { w, h }, visibleWindows: 2, groups });
  it("the area and its head beside Kali's panel; the rail only with two groups", () => {
    const l = studio(1440, 900);
    expect(l.mode).toBe("studio");
    expect(l.rail).toBeNull();
    expect(l.column!.w).toBe(380);
    expect(l.area!.x + l.area!.w).toBeLessThanOrEqual(l.column!.x);
    expect(l.areaHead!.y + l.areaHead!.h).toBeLessThanOrEqual(l.area!.y);
    expect(l.artifact).toEqual(l.area);
    const two = studio(1440, 900, 2);
    expect(two.rail).not.toBeNull();
    expect(two.area!.x).toBeGreaterThan(two.rail!.w);
  });
  it("a small window: the area full width, Kali a bubble under it", () => {
    const l = studio(1100, 700);
    expect(l.column).toBeNull();
    expect(l.bubble).not.toBeNull();
    expect(l.area!.y + l.area!.h).toBeLessThanOrEqual(l.bubble!.y);
  });
  it("with nothing open it is the stage", () => {
    expect(computeLayout({ stage: { w: 1440, h: 900 }, visibleWindows: 0 }).mode).toBe("stage");
  });
});
