import { describe, expect, it } from "vitest";
import { studioView } from "../Pane";
import type { Group } from "../../../workspace/groups";
import type { PaneNode } from "../../../workspace/panes";

const area = { x: 0, y: 0, w: 1400, h: 800 };
const panes: PaneNode = {
  kind: "split", id: "s", dir: "row", ratio: 0.5,
  a: { kind: "leaf", id: "p1", tabIds: [1, 2], activeId: 1 },
  b: { kind: "leaf", id: "p2", tabIds: [3], activeId: 3 },
} as PaneNode;
const group = { id: "g", title: "G", windowIds: [1, 2, 3], pinnedIds: [], activeId: 1, panes } as unknown as Group;

describe("ghost tabs in the Studio", () => {
  it("keep their place but a pane shows its next tab", () => {
    const v = studioView(group, [1, 2, 3], area, 1, 1440, new Set([1]));
    const p1 = v.leaves.find((l) => l.id === "p1")!;
    expect(p1.tabIds).toEqual([1, 2]);
    expect(p1.activeId).toBe(2);
    expect(v.activeLeaf).toBe("p1");
  });
  it("leave a pane with nothing to show when all of its tabs are out", () => {
    const v = studioView(group, [1, 2, 3], area, 1, 1440, new Set([3]));
    expect(v.leaves.find((l) => l.id === "p2")!.activeId).toBeNull();
    expect(v.leaves).toHaveLength(2);
  });
});
