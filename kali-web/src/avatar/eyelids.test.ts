import { describe, expect, it } from "vitest";
import { LID_TRAVEL } from "./avatarRenderer";
import { SVG_MARKUP } from "./avatarMarkup";

describe("eyelid geometry", () => {
  const rects = [...SVG_MARKUP.matchAll(/<g class="upper-lid"[^>]*><rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)];

  it("has an upper lid per eye", () => {
    expect(rects).toHaveLength(2);
  });

  it("a fully closed upper lid covers the whole eye (no gap above the lid edge)", () => {
    const eyeTop = 480 - 105;
    const eyeBottom = 480 + 105;
    for (const [, , y, , h] of rects) {
      const top = Number(y) + LID_TRAVEL;
      const bottom = Number(y) + Number(h) + LID_TRAVEL;
      expect(top).toBeLessThanOrEqual(eyeTop);
      expect(bottom).toBeGreaterThanOrEqual(eyeBottom);
    }
  });

  it("an open upper lid stays above the eye", () => {
    for (const [, , y, , h] of rects) expect(Number(y) + Number(h)).toBeLessThanOrEqual(480 - 105);
  });

  it("each eye has a closed-eye line that starts hidden", () => {
    expect(SVG_MARKUP.match(/class="eye-closed eye-closed-(left|right)"[^>]*opacity="0"/g)).toHaveLength(2);
  });
});
