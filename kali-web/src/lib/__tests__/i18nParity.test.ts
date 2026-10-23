import { describe, expect, it } from "vitest";
import en from "../../locale/en/common.json";
import es from "../../locale/es/common.json";

describe("desktop/chat locale keys", () => {
  it("exist in both languages with the same interpolation variables", () => {
    const enKeys = Object.keys(en).filter((k) => k.startsWith("desktop.") || k.startsWith("chat.") || k.startsWith("settings.keywords.") || k.startsWith("font."));
    for (const key of enKeys) {
      const a = (en as Record<string, string>)[key];
      const b = (es as Record<string, string>)[key];
      expect(b, `missing es key ${key}`).toBeTypeOf("string");
      const vars = (v: string) => (v.match(/{{\w+}}/g) ?? []).sort().join();
      expect(vars(b), key).toBe(vars(a));
    }
  });
});
