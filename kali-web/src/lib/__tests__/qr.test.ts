import { describe, expect, it } from "vitest";
import { encodeQr, penalty } from "../qr";
import fixtures from "./qr.fixtures.json";

// Reference matrices from an independent encoder (python-qrcode 7.4.2, byte mode, fixed mask).
describe("QR encoder", () => {
  for (const f of fixtures as { text: string; ecc: "L" | "M" | "Q" | "H"; mask: number; version: number; rows: string[] }[]) {
    it(`matches the reference for ${f.ecc}/mask ${f.mask}/v${f.version}`, () => {
      const qr = encodeQr(f.text, f.ecc, f.mask);
      expect(qr.version).toBe(f.version);
      expect(qr.modules.map((r) => r.map((c) => (c ? "1" : "0")).join(""))).toEqual(f.rows);
    });
  }

  it("picks the mask with the lowest penalty", () => {
    const auto = encodeQr("https://example.com/kali");
    const scores = Array.from({ length: 8 }, (_, m) => penalty(encodeQr("https://example.com/kali", "M", m).modules));
    expect(penalty(auto.modules)).toBe(Math.min(...scores));
  });

  it("grows the version with the data and refuses what does not fit", () => {
    expect(encodeQr("a").size).toBe(21);
    expect(encodeQr("a".repeat(300)).version).toBeGreaterThan(9);
    expect(() => encodeQr("a".repeat(3000), "H")).toThrow(RangeError);
  });
});
