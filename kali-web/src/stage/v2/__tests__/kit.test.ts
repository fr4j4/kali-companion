import { describe, expect, it } from "vitest";
import { cleanSubtitle } from "../ArtifactShell";
import { isResting, placeNodes, type NodeStatus } from "../mapModel";
import { humanizeTool, toolLabel } from "../../../lib/toolLabels";
import { computeLayout, STAGE_AVATAR } from "../../../workspace/layout";

describe("cleanSubtitle", () => {
  it("drops the parts that repeat the title", () => {
    expect(cleanSubtitle("styles.css · css", "styles.css")).toBe("css");
    expect(cleanSubtitle("Styles.CSS", "styles.css")).toBeNull();
    expect(cleanSubtitle("taller-lupa · feature/portada", "styles.css")).toBe("taller-lupa · feature/portada");
    expect(cleanSubtitle(null, "x")).toBeNull();
  });
});

describe("orbs at rest", () => {
  const st = (state: NodeStatus["state"]): NodeStatus => ({ id: "research", state, since: 0 } as NodeStatus);
  it("are dots unless they do something", () => {
    expect(isResting("research", "idle", "stage")).toBe(true);
    expect(isResting("research", "done", "stage")).toBe(true);
    expect(isResting("research", "working", "stage")).toBe(false);
    expect(isResting("research", "permission", "compact")).toBe(false);
    expect(isResting("memory", "recalling", "stage")).toBe(false);
    expect(isResting("files", "failed", "stage")).toBe(false);
  });
  it("artifact nodes are always cards, the mini map always labels", () => {
    expect(isResting("document", "idle", "stage")).toBe(false);
    expect(isResting("research", "working", "mini")).toBe(true);
  });
  it("placeNodes marks them and gives them a label box", () => {
    const map = { x: 0, y: 0, w: 1000, h: 600 };
    const placed = placeNodes(["research", "files"], { research: st("working") }, map, { x: 500, y: 300 }, "stage", 1);
    expect(placed.find((p) => p.id === "research")?.resting).toBe(false);
    const files = placed.find((p) => p.id === "files")!;
    expect(files.resting).toBe(true);
    expect(files.card.h).toBeLessThan(30);
  });
});

describe("tool labels", () => {
  const t = (key: string, o?: Record<string, unknown>) => (key === "toolname.web_search" ? "Búsqueda web" : String(o?.defaultValue ?? key));
  it("never show the internal name", () => {
    expect(toolLabel(t, "web_search")).toBe("Búsqueda web");
    expect(toolLabel(t, "game_action")).toBe("Game action");
    expect(humanizeTool("WEB_SEARCH")).toBe("Web search");
  });
});

describe("stage avatar", () => {
  it("is 160 units on the stage", () => {
    const l = computeLayout({ stage: { w: 1440, h: 900 }, visibleWindows: 0 });
    expect(l.avatar).toBe(STAGE_AVATAR);
  });
});
