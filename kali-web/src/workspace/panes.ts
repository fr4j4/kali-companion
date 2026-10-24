/**
 * workspace/panes.ts — The Studio's panes: a tree of splits whose leaves hold tabs.
 *
 *   split(row, .5)                ┌──────────┬──────────┐
 *   ├─ leaf p1  [plan, notas]     │ p1       │ p2       │
 *   └─ split(col, .6)             │          ├──────────┤
 *      ├─ leaf p2 [styles.css]    │          │ p3       │
 *      └─ leaf p3 [terminal]      └──────────┴──────────┘
 *
 * One pane is Foco, two side by side the old Dividido, four the Mosaico. A tab moves to another
 * pane or to a pane's edge (which splits it); an emptied pane goes away and its sibling takes its
 * place. Everything here is pure and generic over the tab id: numbers are window ids on screen,
 * strings are artifact ids in the saved layout. paneLayout turns a tree into rectangles and
 * dividers the same way mosaicLayout did, with the same 320 × 240 minimum per pane.
 */

import type { MosaicPreset, MosaicRatios, Rect } from "./layout";

export interface PaneLeaf<T = number> { kind: "leaf"; id: string; tabIds: T[]; activeId: T | null }
export interface PaneSplit<T = number> { kind: "split"; id: string; dir: "row" | "col"; ratio: number; a: PaneNode<T>; b: PaneNode<T> }
export type PaneNode<T = number> = PaneLeaf<T> | PaneSplit<T>;
export type DropSide = "left" | "right" | "top" | "bottom";

export const PANE_GAP = 12;
/** Minimum pane size in design units. */
export const PANE_MIN = { w: 320, h: 240 };
/** Below this width (px) the tree is painted as one pane with every tab. */
export const PANES_MIN_STAGE_W = 1152;

// ── Reading ─────────────────────────────────────────────

export function leaves<T>(tree: PaneNode<T>): PaneLeaf<T>[] {
  return tree.kind === "leaf" ? [tree] : [...leaves(tree.a), ...leaves(tree.b)];
}

export function leafOf<T>(tree: PaneNode<T>, tabId: T): PaneLeaf<T> | undefined {
  return leaves(tree).find((l) => l.tabIds.includes(tabId));
}

export function leafById<T>(tree: PaneNode<T>, id: string): PaneLeaf<T> | undefined {
  return leaves(tree).find((l) => l.id === id);
}

export function allTabs<T>(tree: PaneNode<T>): T[] {
  return leaves(tree).flatMap((l) => l.tabIds);
}

function nodeIds<T>(tree: PaneNode<T>): string[] {
  return tree.kind === "leaf" ? [tree.id] : [tree.id, ...nodeIds(tree.a), ...nodeIds(tree.b)];
}

/** A node id not used in `tree`. */
export function freshId<T>(tree: PaneNode<T> | null, prefix = "p"): string {
  const used = new Set(tree ? nodeIds(tree) : []);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

// ── Building ────────────────────────────────────────────

export function singleLeaf<T>(tabIds: T[], activeId: T | null = null, id = "p1"): PaneLeaf<T> {
  return { kind: "leaf", id, tabIds: [...tabIds], activeId: activeId != null && tabIds.includes(activeId) ? activeId : tabIds[0] ?? null };
}

function mapLeaves<T>(tree: PaneNode<T>, fn: (l: PaneLeaf<T>) => PaneLeaf<T>): PaneNode<T> {
  if (tree.kind === "leaf") return fn(tree);
  const a = mapLeaves(tree.a, fn);
  const b = mapLeaves(tree.b, fn);
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b };
}

/** Empty leaves go away and their sibling takes the split's place; the root leaf may stay empty. */
export function collapseEmpty<T>(tree: PaneNode<T>): PaneNode<T> {
  if (tree.kind === "leaf") return tree;
  const a = collapseEmpty(tree.a);
  const b = collapseEmpty(tree.b);
  const empty = (n: PaneNode<T>) => n.kind === "leaf" && n.tabIds.length === 0;
  if (empty(a)) return b;
  if (empty(b)) return a;
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b };
}

const withoutTab = <T>(l: PaneLeaf<T>, tabId: T): PaneLeaf<T> => {
  if (!l.tabIds.includes(tabId)) return l;
  const i = l.tabIds.indexOf(tabId);
  const tabIds = l.tabIds.filter((x) => x !== tabId);
  // The neighbour on the right takes over, as in an editor.
  const activeId = l.activeId === tabId ? tabIds[Math.min(i, tabIds.length - 1)] ?? null : l.activeId;
  return { ...l, tabIds, activeId };
};

/** A tab leaves its pane (closed or moved out); an emptied pane collapses. */
export function closeTab<T>(tree: PaneNode<T>, tabId: T): PaneNode<T> {
  if (!leafOf(tree, tabId)) return tree;
  return collapseEmpty(mapLeaves(tree, (l) => withoutTab(l, tabId)));
}

/** A new tab joins a pane (the given one, or the first) and becomes its active tab. */
export function addTab<T>(tree: PaneNode<T>, tabId: T, leafId?: string): PaneNode<T> {
  if (leafOf(tree, tabId)) return tree;
  const target = (leafId && leafById(tree, leafId)) || leaves(tree)[0];
  return mapLeaves(tree, (l) => (l.id === target.id ? { ...l, tabIds: [...l.tabIds, tabId], activeId: tabId } : l));
}

/** Make a tab the one its pane shows. */
export function setActive<T>(tree: PaneNode<T>, tabId: T): PaneNode<T> {
  const leaf = leafOf(tree, tabId);
  if (!leaf || leaf.activeId === tabId) return tree;
  return mapLeaves(tree, (l) => (l.id === leaf.id ? { ...l, activeId: tabId } : l));
}

/** Move a tab into a pane (at `index`, the end by default). */
export function moveTab<T>(tree: PaneNode<T>, tabId: T, toLeafId: string, index?: number): PaneNode<T> {
  const from = leafOf(tree, tabId);
  const to = leafById(tree, toLeafId);
  if (!to) return tree;
  if (from && from.id === to.id) {
    const ids = to.tabIds.filter((x) => x !== tabId);
    ids.splice(Math.max(0, Math.min(ids.length, index ?? ids.length)), 0, tabId);
    return mapLeaves(tree, (l) => (l.id === to.id ? { ...l, tabIds: ids, activeId: tabId } : l));
  }
  let next = mapLeaves(tree, (l) => {
    if (l.id === to.id) {
      const ids = [...l.tabIds];
      ids.splice(Math.max(0, Math.min(ids.length, index ?? ids.length)), 0, tabId);
      return { ...l, tabIds: ids, activeId: tabId };
    }
    return withoutTab(l, tabId);
  });
  next = collapseEmpty(next);
  return next;
}

/** Drop a tab on a pane's edge: the pane splits and the tab gets the new half. */
export function splitAt<T>(tree: PaneNode<T>, leafId: string, side: DropSide, tabId: T): PaneNode<T> {
  const target = leafById(tree, leafId);
  if (!target) return tree;
  // Splitting a pane with its only tab would leave the old half empty.
  if (target.tabIds.length === 1 && target.tabIds[0] === tabId) return tree;
  const newLeaf: PaneLeaf<T> = { kind: "leaf", id: freshId(tree), tabIds: [tabId], activeId: tabId };
  const sid = freshId(tree, "s");
  const dir: "row" | "col" = side === "left" || side === "right" ? "row" : "col";
  const first = side === "left" || side === "top";
  const replace = (node: PaneNode<T>): PaneNode<T> => {
    if (node.kind === "leaf") {
      if (node.id !== leafId) return withoutTab(node, tabId);
      const old = withoutTab(node, tabId);
      return { kind: "split", id: sid, dir, ratio: 0.5, a: first ? newLeaf : old, b: first ? old : newLeaf };
    }
    return { ...node, a: replace(node.a), b: replace(node.b) };
  };
  return collapseEmpty(replace(tree));
}

export function setRatio<T>(tree: PaneNode<T>, splitId: string, ratio: number): PaneNode<T> {
  if (tree.kind === "leaf") return tree;
  if (tree.id === splitId) return { ...tree, ratio: Math.max(0.05, Math.min(0.95, ratio)) };
  const a = setRatio(tree.a, splitId, ratio);
  const b = setRatio(tree.b, splitId, ratio);
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b };
}

/**
 * Make the tree hold exactly `tabIds`: tabs that are gone leave, new ones join the pane of
 * `activeId` (or the first pane), and the pane of `activeId` shows it.
 */
export function reconcile<T>(tree: PaneNode<T> | null | undefined, tabIds: T[], activeId: T | null): PaneNode<T> {
  if (!tree) return singleLeaf(tabIds, activeId);
  let next: PaneNode<T> = tree;
  for (const id of allTabs(tree)) if (!tabIds.includes(id)) next = closeTab(next, id);
  const home = activeId != null ? leafOf(next, activeId)?.id : undefined;
  for (const id of tabIds) if (!leafOf(next, id)) next = addTab(next, id, home);
  if (activeId != null && tabIds.includes(activeId)) next = setActive(next, activeId);
  return next;
}

/**
 * The layouts of Ctrl+1…4, filled with the tabs in their current order: each pane gets one tab
 * (the panes' active tabs first) and the rest stay in the first pane. Never more panes than tabs.
 */
export function toPreset<T>(tree: PaneNode<T>, n: 1 | 2 | 3 | 4): PaneNode<T> {
  const ls = leaves(tree);
  const actives = ls.map((l) => l.activeId).filter((x): x is T => x != null);
  const order = [...actives, ...allTabs(tree).filter((x) => !actives.includes(x))];
  const count = Math.max(1, Math.min(n, order.length));
  const fronts = order.slice(0, count);
  const rest = order.slice(count);
  const firstActive = ls[0]?.activeId ?? null;
  const leaf = (i: number): PaneLeaf<T> => {
    const tabs = i === 0 ? [fronts[0], ...rest].filter((x) => x !== undefined) : [fronts[i]];
    return { kind: "leaf", id: `p${i + 1}`, tabIds: tabs, activeId: i === 0 && firstActive != null && tabs.includes(firstActive) ? firstActive : tabs[0] ?? null };
  };
  return presetShape(count, leaf);
}

function presetShape<T>(count: number, leaf: (i: number) => PaneLeaf<T>, ratios: MosaicRatios = { a: 0.5, b: 0.5 }, rows = false): PaneNode<T> {
  if (count <= 1) return leaf(0);
  if (count === 2) return { kind: "split", id: "s1", dir: rows ? "col" : "row", ratio: ratios.a, a: leaf(0), b: leaf(1) };
  if (count === 3) return { kind: "split", id: "s1", dir: "row", ratio: ratios.a, a: leaf(0), b: { kind: "split", id: "s2", dir: "col", ratio: ratios.b, a: leaf(1), b: leaf(2) } };
  return {
    kind: "split", id: "s1", dir: "row", ratio: ratios.a,
    a: { kind: "split", id: "s2", dir: "col", ratio: ratios.b, a: leaf(0), b: leaf(2) },
    b: { kind: "split", id: "s3", dir: "col", ratio: ratios.b, a: leaf(1), b: leaf(3) },
  };
}

/**
 * A group saved before the panes (mode, mosaic preset, ratios and panel order) becomes a tree:
 * Foco and Pantalla completa are one pane, Mosaico its preset with the panels in their order,
 * Dividido its visible windows side by side (up to three).
 */
export function fromMosaic<T>(g: { mode: string; preset: MosaicPreset | null; ratios: MosaicRatios; tabIds: T[]; panelIds?: T[]; activeId?: T | null }): PaneNode<T> {
  const tabs = g.tabIds;
  const active = g.activeId ?? null;
  if (g.mode === "focus" || g.mode === "fullscreen" || tabs.length <= 1) return singleLeaf(tabs, active);
  const preset: MosaicPreset = g.mode === "mosaic" ? (g.preset ?? auto(tabs.length)) : auto(Math.min(3, tabs.length));
  const panels = { "1": 1, "2c": 2, "2r": 2, "1+2": 3, "2x2": 4 }[preset];
  const count = Math.min(panels, tabs.length);
  const chosen = (g.panelIds ?? []).filter((id) => tabs.includes(id)).slice(0, count);
  for (const id of tabs) { if (chosen.length >= count) break; if (!chosen.includes(id)) chosen.push(id); }
  const rest = tabs.filter((id) => !chosen.includes(id));
  const leaf = (i: number): PaneLeaf<T> => {
    const ids = i === 0 ? [chosen[0], ...rest] : [chosen[i]];
    return { kind: "leaf", id: `p${i + 1}`, tabIds: ids, activeId: ids[0] };
  };
  return presetShape(count, leaf, g.ratios, preset === "2r");
}
const auto = (n: number): MosaicPreset => (n <= 1 ? "1" : n === 2 ? "2c" : n === 3 ? "1+2" : "2x2");

/** Same tree with other tab ids (window ids ⇄ artifact ids); tabs `map` drops go away. */
export function mapTabs<A, B>(tree: PaneNode<A>, map: (id: A) => B | undefined): PaneNode<B> {
  const conv = (node: PaneNode<A>): PaneNode<B> => {
    if (node.kind === "leaf") {
      const tabIds = node.tabIds.map(map).filter((x): x is B => x !== undefined);
      const activeId = node.activeId != null ? map(node.activeId) ?? null : null;
      return { kind: "leaf", id: node.id, tabIds, activeId: activeId != null && tabIds.includes(activeId) ? activeId : tabIds[0] ?? null };
    }
    return { kind: "split", id: node.id, dir: node.dir, ratio: node.ratio, a: conv(node.a), b: conv(node.b) };
  };
  return collapseEmpty(conv(tree));
}

// ── Geometry ────────────────────────────────────────────

export interface PaneDivider {
  /** The split it moves. */
  id: string;
  dir: "row" | "col";
  rect: Rect;
  /** The rectangle the ratio is measured on, and the range it may take. */
  span: Rect;
  min: number;
  max: number;
  ratio: number;
}
export interface PaneLayout { leaves: { id: string; rect: Rect }[]; dividers: PaneDivider[] }

/** Smallest size a subtree needs (design units × k), so ratios never squeeze a pane under it. */
function minSize<T>(node: PaneNode<T>, k: number): { w: number; h: number } {
  if (node.kind === "leaf") return { w: PANE_MIN.w * k, h: PANE_MIN.h * k };
  const a = minSize(node.a, k);
  const b = minSize(node.b, k);
  const gap = PANE_GAP * k;
  return node.dir === "row" ? { w: a.w + b.w + gap, h: Math.max(a.h, b.h) } : { w: Math.max(a.w, b.w), h: a.h + b.h + gap };
}

/** Rectangles of the panes in `area` (px) and the dividers between them. */
export function paneLayout<T>(area: Rect, tree: PaneNode<T>, k = 1): PaneLayout {
  const out: PaneLayout = { leaves: [], dividers: [] };
  const gap = PANE_GAP * k;
  const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  const walk = (node: PaneNode<T>, r: Rect) => {
    if (node.kind === "leaf") { out.leaves.push({ id: node.id, rect: round(r) }); return; }
    const row = node.dir === "row";
    const span = (row ? r.w : r.h) - gap;
    const ma = minSize(node.a, k);
    const mb = minSize(node.b, k);
    let min = Math.min(0.5, (row ? ma.w : ma.h) / Math.max(1, span));
    let max = Math.max(0.5, 1 - (row ? mb.w : mb.h) / Math.max(1, span));
    if (min > max) { min = 0.5; max = 0.5; }
    const ratio = Math.max(min, Math.min(max, node.ratio));
    const first = span * ratio;
    const ra: Rect = row ? { x: r.x, y: r.y, w: first, h: r.h } : { x: r.x, y: r.y, w: r.w, h: first };
    const rb: Rect = row ? { x: r.x + first + gap, y: r.y, w: r.w - first - gap, h: r.h } : { x: r.x, y: r.y + first + gap, w: r.w, h: r.h - first - gap };
    const d: Rect = row ? { x: r.x + first, y: r.y, w: gap, h: r.h } : { x: r.x, y: r.y + first, w: r.w, h: gap };
    out.dividers.push({ id: node.id, dir: node.dir, rect: round(d), span: round(r), min, max, ratio });
    walk(node.a, ra);
    walk(node.b, rb);
  };
  walk(tree, area);
  return out;
}

/** Where a drop at (x, y) over a pane lands: its middle, or one of its four edges (outer quarter). */
export function dropZone(rect: Rect, x: number, y: number): "center" | DropSide {
  const fx = (x - rect.x) / Math.max(1, rect.w);
  const fy = (y - rect.y) / Math.max(1, rect.h);
  const edges: [DropSide, number][] = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]];
  const [side, d] = edges.reduce((best, e) => (e[1] < best[1] ? e : best));
  return d < 0.25 ? side : "center";
}

/** The highlight a drop zone shows inside a pane. */
export function dropRect(rect: Rect, zone: "center" | DropSide): Rect {
  if (zone === "center") return rect;
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  if (zone === "left") return { ...rect, w: hw };
  if (zone === "right") return { ...rect, x: rect.x + hw, w: hw };
  if (zone === "top") return { ...rect, h: hh };
  return { ...rect, y: rect.y + hh, h: hh };
}
