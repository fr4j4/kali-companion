import { describe, expect, it } from "vitest";
import {
  computeGameOffsets,
  computeGameScale,
  GAME_SCALE_DESKTOP_BASE,
  GAME_SCALE_DESKTOP_MAX,
} from "../gameViewportSizing";

describe("gameViewportSizing", () => {
  it("returns 0 for invalid dimensions", () => {
    expect(
      computeGameScale({
        naturalWidth: 0,
        naturalHeight: 400,
        containerWidth: 1000,
        containerHeight: 800,
        isMobile: false,
      }),
    ).toBe(0);
  });

  it("boosts scale on large desktop viewports without exceeding fit", () => {
    const scale = computeGameScale({
      naturalWidth: 400,
      naturalHeight: 400,
      containerWidth: 1200,
      containerHeight: 1000,
      isMobile: false,
      safePadding: 0,
    });

    expect(scale).toBeCloseTo(Math.min(2.5, 2.5 * GAME_SCALE_DESKTOP_BASE, GAME_SCALE_DESKTOP_MAX), 2);
  });

  it("keeps mobile scale at or below fit", () => {
    const scale = computeGameScale({
      naturalWidth: 400,
      naturalHeight: 400,
      containerWidth: 420,
      containerHeight: 700,
      isMobile: true,
      safePadding: 0,
    });

    expect(scale).toBeLessThanOrEqual(1.05);
  });

  it("centers game content", () => {
    expect(computeGameOffsets(400, 400, 2, 1000, 900)).toEqual({
      x: 100,
      y: 50,
    });
  });
});
