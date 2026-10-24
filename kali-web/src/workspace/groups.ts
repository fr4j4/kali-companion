/**
 * workspace/groups.ts — Pure model of window groups ("one task, one group").
 *
 * Every open window belongs to exactly one group: what comes from the same task lives together,
 * remembers how its panes are split (the Studio's tree, workspace/panes.ts), and can be moved, renamed,
 * pinned or put away as a whole. The canvas shows one active group at a time; the rest live in the
 * tray. All functions here return new state and never mutate; the hook in stage/v2 wires them to
 * the workspace windows and persists them per session.
 */

import { addTab, closeTab, leafById, leafOf, leaves, mapTabs, reconcile, setActive, singleLeaf, type MosaicPreset, type MosaicRatios, type PaneNode } from "./panes";

/** Colour slot of a group; maps to a theme token so every theme stays legible. */
export const GROUP_COLORS = ["accent", "accent2", "ok", "warn", "err", "muted"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface Group {
  id: string;
  title: string;
  color: GroupColor;
  /** Windows in the group, in tab order. */
  windowIds: number[];
  /** The Studio's panes and their tabs (every window of the group is in exactly one pane). */
  panes: PaneNode;
  /** A pane shown alone (maximized); the tree is kept to come back to. */
  zoomed: string | null;
  /** The tab you are on (its pane is the active pane). */
  activeId: number | null;
  /** Pinned windows stay open when the group is put away. */
  pinnedIds: number[];
  createdAt: number;
  lastUsed: number;
}

export interface ClosedEntry {
  windowId: number;
  artifactId?: string;
  title: string;
  type: string;
  groupId: string | null;
  groupTitle: string;
  closedAt: number;
  /** Put away on purpose ("Guardar") rather than closed. */
  saved: boolean;
}

export interface GroupsState {
  groups: Group[];
  activeGroupId: string | null;
  closed: ClosedEntry[];
}

export const EMPTY_GROUPS: GroupsState = { groups: [], activeGroupId: null, closed: [] };
/** Recently closed entries kept for "Reopen" (and undo). */
export const MAX_CLOSED = 30;

let seq = 0;
export function newGroupId(): string {
  seq += 1;
  return `g${Date.now().toString(36)}${seq.toString(36)}`;
}

function nextColor(state: GroupsState): GroupColor {
  const used = new Set(state.groups.map((g) => g.color));
  return GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[state.groups.length % GROUP_COLORS.length];
}

export function makeGroup(state: GroupsState, title: string, opts: Partial<Group> = {}, now = Date.now()): Group {
  return {
    id: opts.id ?? newGroupId(),
    title: title.trim() || "…",
    color: opts.color ?? nextColor(state),
    windowIds: opts.windowIds ?? [],
    activeId: opts.activeId ?? opts.windowIds?.[0] ?? null,
    panes: opts.panes ?? singleLeaf(opts.windowIds ?? [], opts.activeId ?? null),
    zoomed: null,
    pinnedIds: opts.pinnedIds ?? [],
    createdAt: now,
    lastUsed: now,
  };
}

const mapGroup = (state: GroupsState, id: string, fn: (g: Group) => Group): GroupsState => ({
  ...state,
  groups: state.groups.map((g) => (g.id === id ? fn(g) : g)),
});

export function groupOf(state: GroupsState, windowId: number): Group | undefined {
  return state.groups.find((g) => g.windowIds.includes(windowId));
}

export function activeGroup(state: GroupsState): Group | undefined {
  return state.groups.find((g) => g.id === state.activeGroupId);
}

/** Drop a window from whatever group holds it (empty groups go away). */
export function detach(state: GroupsState, windowId: number): GroupsState {
  const groups = state.groups
    .map((g) => {
      if (!g.windowIds.includes(windowId)) return g;
      const windowIds = g.windowIds.filter((id) => id !== windowId);
      const from = leafOf(g.panes, windowId);
      const panes = closeTab(g.panes, windowId);
      // The tab next to the closed one, in its pane (or the first pane when that one emptied).
      const leafActive = ((from && leafById(panes, from.id)) || leaves(panes)[0])?.activeId;
      return {
        ...g,
        windowIds,
        panes,
        zoomed: g.zoomed && panes.kind !== "leaf" ? g.zoomed : null,
        pinnedIds: g.pinnedIds.filter((id) => id !== windowId),
        activeId: g.activeId === windowId ? (leafActive ?? windowIds[windowIds.length - 1] ?? null) : g.activeId,
      };
    })
    .filter((g) => g.windowIds.length > 0);
  const activeGroupId = groups.some((g) => g.id === state.activeGroupId) ? state.activeGroupId : (groups[groups.length - 1]?.id ?? null);
  return { ...state, groups, activeGroupId };
}

/** Put a window in a group (moving it out of its previous one) and make it the group's tab. */
export function assign(state: GroupsState, windowId: number, groupId: string, now = Date.now()): GroupsState {
  const without = detach(state, windowId);
  // The target may have been removed by detach if it only held this window.
  const exists = without.groups.some((g) => g.id === groupId);
  const base = exists ? without : { ...without, groups: [...without.groups, { ...state.groups.find((g) => g.id === groupId)!, windowIds: [] }] };
  return mapGroup(base, groupId, (g) => {
    // A new tab opens in the pane you are on.
    const home = reconcile(g.panes, g.windowIds, g.activeId);
    const leaf = g.activeId != null ? leafOf(home, g.activeId)?.id : undefined;
    return { ...g, windowIds: [...g.windowIds, windowId], panes: addTab(home, windowId, leaf), activeId: windowId, lastUsed: now };
  });
}

/** New group holding `windowIds` (taken from their groups). */
export function createGroup(state: GroupsState, title: string, windowIds: number[] = [], opts: Partial<Group> = {}, now = Date.now()): { state: GroupsState; id: string } {
  let next = state;
  for (const id of windowIds) next = detach(next, id);
  const group = makeGroup(next, title, { ...opts, windowIds: [...windowIds] }, now);
  return { state: { ...next, groups: [...next.groups, group] }, id: group.id };
}

export function activate(state: GroupsState, groupId: string | null, now = Date.now()): GroupsState {
  if (groupId === null) return { ...state, activeGroupId: null };
  if (!state.groups.some((g) => g.id === groupId)) return state;
  return mapGroup({ ...state, activeGroupId: groupId }, groupId, (g) => ({ ...g, lastUsed: now }));
}

export function setActiveTab(state: GroupsState, windowId: number, now = Date.now()): GroupsState {
  const g = groupOf(state, windowId);
  if (!g) return state;
  return mapGroup({ ...state, activeGroupId: g.id }, g.id, (x) => {
    const panes = setActive(reconcile(x.panes, x.windowIds, windowId), windowId);
    // Choosing a tab of another pane while one is maximized brings the tree back.
    const zoomed = x.zoomed && leafOf(panes, windowId)?.id !== x.zoomed ? null : x.zoomed;
    return { ...x, activeId: windowId, panes, zoomed, lastUsed: now };
  });
}

/** Replace a group's panes (a drag, a preset, a divider); the tree is reconciled with its tabs. */
export function setPanes(state: GroupsState, groupId: string, fn: (tree: PaneNode, g: Group) => PaneNode): GroupsState {
  return mapGroup(state, groupId, (g) => {
    const panes = reconcile(fn(reconcile(g.panes, g.windowIds, g.activeId), g), g.windowIds, null);
    const zoomed = g.zoomed && panes.kind !== "leaf" && leafById(panes, g.zoomed) ? g.zoomed : null;
    return { ...g, panes, zoomed };
  });
}

/** Show one pane alone, or the whole tree again. */
export function zoomPane(state: GroupsState, groupId: string, leafId: string | null): GroupsState {
  return mapGroup(state, groupId, (g) => ({ ...g, zoomed: leafId && g.panes.kind !== "leaf" && leafById(g.panes, leafId) ? leafId : null }));
}

export function rename(state: GroupsState, groupId: string, title: string): GroupsState {
  const clean = title.trim();
  if (!clean) return state;
  return mapGroup(state, groupId, (g) => ({ ...g, title: clean }));
}

export function togglePin(state: GroupsState, windowId: number): GroupsState {
  const g = groupOf(state, windowId);
  if (!g) return state;
  return mapGroup(state, g.id, (x) => ({
    ...x,
    pinnedIds: x.pinnedIds.includes(windowId) ? x.pinnedIds.filter((id) => id !== windowId) : [...x.pinnedIds, windowId],
  }));
}

/** Move a tab within its group (drag to reorder). */
export function reorder(state: GroupsState, windowId: number, toIndex: number): GroupsState {
  const g = groupOf(state, windowId);
  if (!g) return state;
  const ids = g.windowIds.filter((id) => id !== windowId);
  ids.splice(Math.max(0, Math.min(ids.length, toIndex)), 0, windowId);
  return mapGroup(state, g.id, (x) => ({ ...x, windowIds: ids }));
}

/** Record a window as closed (or saved) for "Recently closed" and undo. */
export function recordClosed(state: GroupsState, entry: Omit<ClosedEntry, "groupId" | "groupTitle"> & { groupId?: string | null }): GroupsState {
  const g = entry.groupId !== undefined ? state.groups.find((x) => x.id === entry.groupId) : groupOf(state, entry.windowId);
  const closed: ClosedEntry = { ...entry, groupId: g?.id ?? entry.groupId ?? null, groupTitle: g?.title ?? "" };
  const rest = state.closed.filter((c) => c.windowId !== entry.windowId);
  return { ...state, closed: [closed, ...rest].slice(0, MAX_CLOSED) };
}

export function forgetClosed(state: GroupsState, windowId: number): GroupsState {
  return { ...state, closed: state.closed.filter((c) => c.windowId !== windowId) };
}

/** Drop windows that no longer exist (closed elsewhere, session reset). */
export function prune(state: GroupsState, alive: Set<number>): GroupsState {
  let next = state;
  for (const g of state.groups) for (const id of g.windowIds) if (!alive.has(id)) next = detach(next, id);
  return next;
}

/** Serializable shape per session: windows are referred to by artifact id. */
export interface PersistedGroups {
  /** 2 since the panes; version 1 (no `panes`) is migrated with fromMosaic when it loads. */
  v?: number;
  active: string | null;
  groups: {
    id: string; title: string; color: GroupColor; artifacts: string[]; pinned: string[]; panes?: PaneNode<string>;
    /** Format 1 only: how the group was laid out before the panes. */
    mode?: string; preset?: MosaicPreset | null; ratios?: MosaicRatios;
  }[];
}

export function toPersisted(state: GroupsState, artifactOf: (windowId: number) => string | undefined): PersistedGroups {
  return {
    v: 2,
    active: state.activeGroupId,
    groups: state.groups.map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
      artifacts: g.windowIds.map(artifactOf).filter((a): a is string => !!a),
      pinned: g.pinnedIds.map(artifactOf).filter((a): a is string => !!a),
      panes: mapTabs(reconcile(g.panes, g.windowIds, g.activeId), artifactOf),
    })),
  };
}
