import { describe, expect, it } from "vitest";
import { ansiToHtml } from "../ansi";

describe("ansiToHtml", () => {
  it("escapes HTML special chars", () => {
    const result = ansiToHtml("<script>alert(1)</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("converts plain text without changes", () => {
    const result = ansiToHtml("hello world");
    expect(result).toBe("hello world");
  });

  it("converts ANSI red color", () => {
    const result = ansiToHtml("\x1b[31mred text\x1b[0m");
    expect(result).toContain("red text");
    expect(result).toContain("style");
  });

  it("handles empty string", () => {
    expect(ansiToHtml("")).toBe("");
  });
});