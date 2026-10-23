import { describe, expect, it } from "vitest";
import { applyLoadedArtifact, createWindowData } from "../windowManager";
import type { ArtifactEvent } from "../../lib/protocol";

const html = { event: "artifact", id: "a1", type: "html", windowType: "html", title: "Página", content: "<p>hi</p>", update: "create" } as ArtifactEvent;

describe("applyLoadedArtifact", () => {
  it("gives a placeholder window opened from the library the real type and title", () => {
    const placeholder = createWindowData({ type: "widget", title: "…", artifactId: "a1", content: null });
    const w = applyLoadedArtifact(placeholder, html);
    expect(w.type).toBe("html");
    expect(w.title).toBe("Página");
    expect(w.content).toBe(html);
  });

  it("keeps type and title of a window that already has them", () => {
    const existing = createWindowData({ type: "diff", title: "Mío", artifactId: "a1", content: { ...html, content: null } });
    const w = applyLoadedArtifact(existing, html);
    expect(w.type).toBe("diff");
    expect(w.title).toBe("Mío");
    expect(w.content).toBe(html);
  });
});
