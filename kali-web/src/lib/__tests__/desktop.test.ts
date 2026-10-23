import { describe, expect, it } from "vitest";
import { artifactsNativeEnabled, isDesktop } from "../desktop";

describe("desktop mode gating", () => {
  it("reports browser mode and disables native artifacts without the bridge", () => {
    expect(isDesktop()).toBe(false);
    expect(artifactsNativeEnabled()).toBe(false);
  });
});
