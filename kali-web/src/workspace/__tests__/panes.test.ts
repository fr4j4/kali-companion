import { describe, expect, it } from "vitest";
import {
  addTab, allTabs, closeTab, dropZone, fromMosaic, leafOf, leaves, mapTabs, moveTab, paneLayout, reconcile, setRatio,
  singleLeaf, splitAt, toPreset, type PaneNode,
} from "../panes";

const two = (): PaneNode => ({
  kind: "split", id: "s1", dir: "row", ratio: 0.5,
  a: { kind: "leaf", id: "p1", tabIds: [1, 2], activeId: 2 },
  b: { kind: "leaf", id: "p2", tabIds: [3], activeId: 3 },
});

describe("pane operations", () => {
  it("a closed tab hands over to its neighbour and an emptied pane collapses", () => {
    const t = closeTab(two(), 2);
    expect(leafOf(t, 1)!.activeId).toBe(1);
    const one = closeTab(two(), 3);
    expect(one.kind).toBe("leaf");
    expect(allTabs(one)).toEqual([1, 2]);
  });

  it("a new tab joins the pane it is given (the first by default) and shows", () => {
    expect(leafOf(addTab(two(), 9, "p2"), 9)!.id).toBe("p2");
    expect(leafOf(addTab(two(), 9), 9)!.activeId).toBe(9);
  });

  it("moving a tab to another pane, or within its own row", () => {
    const t = moveTab(two(), 1, "p2", 0);
    expect(leafOf(t, 1)!.id).toBe("p2");
    expect(leafOf(t, 1)!.tabIds).toEqual([1, 3]);
    expect(leafOf(moveTab(two(), 2, "p1", 0), 2)!.tabIds).toEqual([2, 1]);
    // The last tab of a pane leaves it: the pane goes away.
    expect(moveTab(two(), 3, "p1").kind).toBe("leaf");
  });

  it("a tab dropped on an edge splits the pane", () => {
    const t = splitAt(singleLeaf([1, 2]), "p1", "right", 2);
    expect(t.kind).toBe("split");
    if (t.kind !== "split") return;
    expect(t.dir).toBe("row");
    expect(allTabs(t.a)).toEqual([1]);
    expect(allTabs(t.b)).toEqual([2]);
    const top = splitAt(singleLeaf([1, 2]), "p1", "top", 2);
    expect(top.kind === "split" && top.dir === "col" && allTabs(top.a)[0] === 2).toBe(true);
    // A pane's only tab cannot split it.
    const lone = singleLeaf([1]);
    expect(splitAt(lone, "p1", "left", 1)).toBe(lone);
  });

  it("node ids stay unique after splits", () => {
    let t: PaneNode = singleLeaf([1, 2, 3, 4]);
    t = splitAt(t, "p1", "right", 2);
    t = splitAt(t, leafOf(t, 2)!.id, "bottom", 2);
    t = splitAt(t, leafOf(t, 1)!.id, "bottom", 3);
    const ids = leaves(t).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reconcile keeps the tree in step with the group's tabs", () => {
    const t = reconcile(two(), [1, 3, 7], 3);
    expect(allTabs(t).sort()).toEqual([1, 3, 7]);
    expect(leafOf(t, 7)!.id).toBe("p2");
    expect(reconcile(null, [4, 5], 5)).toEqual(singleLeaf([4, 5], 5));
  });

  it("presets: one to four panes, never more than tabs, active tabs in front", () => {
    expect(leaves(toPreset(two(), 1)).length).toBe(1);
    expect(allTabs(toPreset(two(), 1))).toEqual([2, 3, 1]);
    const four = toPreset(singleLeaf([1, 2, 3, 4, 5]), 4);
    // p1 top left, p2 top right, p3 bottom left, p4 bottom right.
    expect([...leaves(four)].sort((a, b) => a.id.localeCompare(b.id)).map((l) => l.tabIds)).toEqual([[1, 5], [2], [3], [4]]);
    expect(leaves(toPreset(two(), 4)).length).toBe(3);
  });

  it("setRatio and mapTabs", () => {
    const t = setRatio(two(), "s1", 0.7);
    expect(t.kind === "split" && t.ratio).toBe(0.7);
    const named = mapTabs(two(), (id) => (id === 3 ? undefined : `a${id}`));
    expect(named.kind).toBe("leaf");
    expect(allTabs(named)).toEqual(["a1", "a2"]);
  });
});

describe("migration from the mosaic", () => {
  const base = { ratios: { a: 0.4, b: 0.6 }, tabIds: [1, 2, 3, 4] };
  it("Foco and Pantalla completa are one pane", () => {
    expect(fromMosaic({ ...base, mode: "focus", preset: null }).kind).toBe("leaf");
    expect(fromMosaic({ ...base, mode: "fullscreen", preset: "2x2" }).kind).toBe("leaf");
  });
  it("each mosaic preset keeps its shape, ratios and panel order", () => {
    const c2 = fromMosaic({ ...base, mode: "mosaic", preset: "2c", panelIds: [3, 1] });
    expect(c2.kind === "split" && c2.dir === "row" && c2.ratio === 0.4).toBe(true);
    expect(leaves(c2).map((l) => l.tabIds)).toEqual([[3, 2, 4], [1]]);
    const r2 = fromMosaic({ ...base, mode: "mosaic", preset: "2r" });
    expect(r2.kind === "split" && r2.dir).toBe("col");
    expect(leaves(fromMosaic({ ...base, mode: "mosaic", preset: "1+2" })).length).toBe(3);
    expect(leaves(fromMosaic({ ...base, mode: "mosaic", preset: "2x2" })).map((l) => l.tabIds)).toEqual([[1], [3], [2], [4]]);
  });
  it("Dividido shows its windows side by side, up to three", () => {
    expect(leaves(fromMosaic({ ...base, mode: "split", preset: null })).length).toBe(3);
    expect(fromMosaic({ mode: "split", preset: null, ratios: base.ratios, tabIds: [1] }).kind).toBe("leaf");
  });
});

describe("paneLayout", () => {
  const area = { x: 0, y: 0, w: 1000, h: 800 };
  it("fills the area with gaps and keeps every pane over the minimum", () => {
    for (const n of [1, 2, 3, 4] as const) {
      const pl = paneLayout(area, toPreset(singleLeaf([1, 2, 3, 4]), n), 1);
      expect(pl.leaves.length).toBe(n);
      expect(pl.dividers.length).toBe(n === 4 ? 3 : n - 1);
      for (const l of pl.leaves) {
        expect(l.rect.w).toBeGreaterThanOrEqual(320);
        expect(l.rect.h).toBeGreaterThanOrEqual(240);
        expect(l.rect.x + l.rect.w).toBeLessThanOrEqual(1000);
      }
    }
  });
  it("clamps a ratio that would squeeze a pane", () => {
    const pl = paneLayout(area, setRatio(two(), "s1", 0.05), 1);
    expect(pl.leaves[0].rect.w).toBeGreaterThanOrEqual(320);
  });
  it("drop zones: edges are the outer quarter", () => {
    const r = { x: 0, y: 0, w: 400, h: 400 };
    expect(dropZone(r, 200, 200)).toBe("center");
    expect(dropZone(r, 20, 200)).toBe("left");
    expect(dropZone(r, 390, 200)).toBe("right");
    expect(dropZone(r, 200, 30)).toBe("top");
    expect(dropZone(r, 200, 380)).toBe("bottom");
  });
});
