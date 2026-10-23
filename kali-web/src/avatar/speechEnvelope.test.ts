import { describe, expect, it } from "vitest";
import { speechEnvelope } from "./speechEnvelope";

describe("speechEnvelope", () => {
  it("stays within 0..1 and actually moves", () => {
    const values = Array.from({ length: 200 }, (_, i) => speechEnvelope(i * 16));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.4);
  });
});
