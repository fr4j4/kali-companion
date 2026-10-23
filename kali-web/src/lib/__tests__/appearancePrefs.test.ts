import { beforeEach, describe, expect, it } from "vitest";
import { applyFont, loadFont, saveFont } from "../appearancePrefs";

describe("appearancePrefs", () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute("data-font"); });

  it("defaults to the bundled font and ignores unknown values", () => {
    expect(loadFont()).toBe("default");
    localStorage.setItem("kali.font", "comic");
    expect(loadFont()).toBe("default");
  });

  it("persists the choice and mirrors it on the root element", () => {
    saveFont("system");
    expect(loadFont()).toBe("system");
    expect(document.documentElement.getAttribute("data-font")).toBe("system");
    applyFont("default");
    expect(document.documentElement.hasAttribute("data-font")).toBe(false);
  });
});
