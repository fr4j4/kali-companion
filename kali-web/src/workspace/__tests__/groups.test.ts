import { describe, expect, it } from "vitest";
import {
  EMPTY_GROUPS, activate, assign, createGroup, detach, groupOf, overflowing, prune, recordClosed,
  rename, reorder, setActiveTab, setMode, setPanes, toPersisted, togglePin, zoomPane,
} from "../groups";
import { allTabs, leafOf, leaves, splitAt } from "../panes";

describe("groups", () => {
  it("creates a group per task and keeps windows in exactly one group", () => {
    let { state, id: a } = createGroup(EMPTY_GROUPS, "Sitio del taller", [1, 2]);
    const made = createGroup(state, "Informe", [3]);
    state = made.state;
    expect(state.groups.map((g) => g.title)).toEqual(["Sitio del taller", "Informe"]);
    state = assign(state, 3, a);
    expect(groupOf(state, 3)?.id).toBe(a);
    // The emptied group disappears.
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].windowIds).toEqual([1, 2, 3]);
    expect(state.groups[0].activeId).toBe(3);
  });

  it("gives each group its own colour", () => {
    let state = EMPTY_GROUPS;
    for (const t of ["a", "b", "c"]) state = createGroup(state, t).state;
    expect(new Set(state.groups.map((g) => g.color)).size).toBe(3);
  });

  it("remembers the mode per group", () => {
    let { state, id } = createGroup(EMPTY_GROUPS, "x", [1]);
    state = setMode(state, id, "mosaic");
    const other = createGroup(state, "y", [2]);
    expect(other.state.groups.find((g) => g.id === id)?.mode).toBe("mosaic");
    expect(other.state.groups.find((g) => g.id === other.id)?.mode).toBe("split");
  });

  it("moves the active group when the active one empties", () => {
    let { state, id: a } = createGroup(EMPTY_GROUPS, "a", [1]);
    const b = createGroup(state, "b", [2]);
    state = activate(b.state, a);
    state = detach(state, 1);
    expect(state.activeGroupId).toBe(b.id);
  });

  it("renames, pins and reorders", () => {
    let { state, id } = createGroup(EMPTY_GROUPS, "x", [1, 2, 3]);
    state = rename(state, id, "  Landing de Kali ");
    expect(state.groups[0].title).toBe("Landing de Kali");
    expect(rename(state, id, "   ")).toBe(state);
    state = togglePin(state, 2);
    expect(state.groups[0].pinnedIds).toEqual([2]);
    state = reorder(state, 3, 0);
    expect(state.groups[0].windowIds).toEqual([3, 1, 2]);
  });

  it("sends the least recently used windows beyond three to the tray, pinned ones last", () => {
    const { state } = createGroup(EMPTY_GROUPS, "x", [1, 2, 3, 4, 5]);
    const g = togglePin(state, 1).groups[0];
    const used: Record<number, number> = { 1: 1, 2: 50, 3: 40, 4: 30, 5: 20 };
    expect(overflowing(g, () => true, (id) => used[id])).toEqual([4, 5]);
    expect(overflowing(g, (id) => id < 4, (id) => used[id])).toEqual([]);
  });

  it("keeps recently closed windows for reopening", () => {
    const { state } = createGroup(EMPTY_GROUPS, "Taller", [7]);
    const next = recordClosed(state, { windowId: 7, artifactId: "a7", title: "Hoja", type: "table", closedAt: 1, saved: false });
    expect(next.closed[0]).toMatchObject({ windowId: 7, groupTitle: "Taller" });
  });

  it("prunes windows that are gone and serializes by artifact id", () => {
    let { state } = createGroup(EMPTY_GROUPS, "x", [1, 2]);
    state = prune(state, new Set([2]));
    expect(state.groups[0].windowIds).toEqual([2]);
    const saved = toPersisted(state, (id) => (id === 2 ? "art-2" : undefined));
    expect(saved.groups[0].artifacts).toEqual(["art-2"]);
  });

  it("keeps the panes in step: new tabs join the pane you are on, closed ones leave", () => {
    let { state, id } = createGroup(EMPTY_GROUPS, "Taller", [1, 2]);
    state = setPanes(state, id, (tree) => splitAt(tree, "p1", "right", 2));
    state = setActiveTab(state, 2);
    state = assign(state, 3, id);
    const g = state.groups[0];
    expect(leafOf(g.panes, 3)!.id).toBe(leafOf(g.panes, 2)!.id);
    state = detach(state, 1);
    expect(leaves(state.groups[0].panes).length).toBe(1);
    expect(allTabs(state.groups[0].panes).sort()).toEqual([2, 3]);
  });

  it("a maximized pane comes back when you pick a tab of another pane", () => {
    let { state, id } = createGroup(EMPTY_GROUPS, "Taller", [1, 2]);
    state = setPanes(state, id, (tree) => splitAt(tree, "p1", "right", 2));
    const right = leafOf(state.groups[0].panes, 2)!.id;
    state = zoomPane(state, id, right);
    expect(state.groups[0].zoomed).toBe(right);
    state = setActiveTab(state, 1);
    expect(state.groups[0].zoomed).toBeNull();
  });

  it("saves version 2 with the panes by artifact id", () => {
    let { state, id } = createGroup(EMPTY_GROUPS, "Taller", [1, 2]);
    state = setPanes(state, id, (tree) => splitAt(tree, "p1", "bottom", 2));
    const saved = toPersisted(state, (w) => `art-${w}`);
    expect(saved.v).toBe(2);
    const panes = saved.groups[0].panes!;
    expect(panes.kind === "split" && panes.dir).toBe("col");
    expect(allTabs(panes)).toEqual(["art-1", "art-2"]);
  });
});
