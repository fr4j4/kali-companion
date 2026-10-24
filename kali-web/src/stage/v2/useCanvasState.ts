/**
 * stage/v2/useCanvasState.ts — Groups, panes and the board of the neural canvas.
 *
 * Wires the pure group model (workspace/groups.ts) to the workspace windows:
 *  - every open window joins a group: the one the core names, the one it had last time, the group
 *    Kali is already working in this turn, the group on screen, or a new one;
 *  - each group splits into the Studio's panes (workspace/panes.ts); a saved tree comes back with
 *    the windows it held, and a layout saved before the panes is migrated (fromMosaic);
 *  - closing records the window under "Recently closed" so it can be reopened or undone;
 *  - on the desktop, a window that went to its own OS window stays in its group as a ghost
 *    (`ghosts`): its tab keeps its place, greyed, with "Bring back";
 *  - groups and their panes are saved per session (by artifact id); the old `kali.v2.kaliView`
 *    preference is dropped.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactEvent } from "../../lib/protocol";
import { artifactPageUrl, isDesktop } from "../../lib/desktop";
import type { WindowData, WorkspaceAPI } from "../../workspace/types";
import { fromMosaic, mapTabs, reconcile, toPreset as treeToPreset, type PaneNode } from "../../workspace/panes";
import {
  EMPTY_GROUPS, activate, activeGroup as pickActive, assign, createGroup, detach, forgetClosed, groupOf,
  recordClosed, setPanes as setGroupPanes, zoomPane as zoomGroupPane, rename as renameGroup, reorder as reorderGroup, setActiveTab,
  togglePin as toggleGroupPin, toPersisted,
  type ClosedEntry, type Group, type GroupsState, type PersistedGroups,
} from "../../workspace/groups";


const STORE_PREFIX = "kali.v2.groups.";

function load(sid: string): (PersistedGroups & { closed?: ClosedEntry[] }) | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + sid);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function save(sid: string, data: PersistedGroups & { closed: ClosedEntry[] }) {
  try { localStorage.setItem(STORE_PREFIX + sid, JSON.stringify(data)); } catch { /* storage full or blocked */ }
}

const isOpen = (w: WindowData) => !w.closed;

interface Opts {
  api: WorkspaceAPI;
  sessionId: string | null;
  isTurnActive: boolean;
  /** What you asked for in this turn: the name a new group takes (the window title otherwise). */
  taskTitle?: string | null;
  /** True while the Hub is on screen: it decides which window is seen, so the content-update
   * focus stands down (read through a ref: the Hub's hook needs this one). */
  hubActive?: { current: boolean };
}

export function useCanvasState({ api, sessionId, isTurnActive, taskTitle, hubActive }: Opts) {
  const [state, setState] = useState<GroupsState>(EMPTY_GROUPS);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** The board (stage/v2/Board.tsx) is open over the canvas. */
  const [board, setBoard] = useState(false);
  const lastUsedRef = useRef(new Map<number, number>());
  const [, setUsedTick] = useState(0);
  const turnRef = useRef(0);
  const windowTurn = useRef(new Map<number, number>());
  const persistedRef = useRef<ReturnType<typeof load>>(null);
  const pendingGroupRef = useRef(new Map<string, string>());
  /** Saved trees (by artifact id) still waiting for their windows; dropped once you change the panes. */
  const templatesRef = useRef(new Map<string, PaneNode<string>>());
  const windowsRef = useRef(api.windows);
  windowsRef.current = api.windows;
  const apiRef = useRef(api);
  apiRef.current = api;
  const hubRef = useRef(hubActive);
  hubRef.current = hubActive;
  const taskTitleRef = useRef(taskTitle);
  taskTitleRef.current = taskTitle;

  // The Map / Conversation switch is gone (the Hub's Hilo replaced it): forget its preference.
  useEffect(() => { try { localStorage.removeItem("kali.v2.kaliView"); } catch { /* ignore */ } }, []);

  const touch = useCallback((id: number) => {
    lastUsedRef.current.set(id, Date.now());
    setUsedTick((n) => n + 1);
  }, []);
  const lastUsed = useCallback((id: number) => lastUsedRef.current.get(id) ?? 0, []);

  // A new turn starts a new "same task" window chain.
  useEffect(() => { if (isTurnActive) turnRef.current += 1; }, [isTurnActive]);

  // Session change: start empty and remember the saved groups to re-assign restored windows.
  useEffect(() => {
    setState(EMPTY_GROUPS);
    setBoard(false);
    lastUsedRef.current.clear();
    windowTurn.current.clear();
    pendingGroupRef.current.clear();
    persistedRef.current = sessionId ? load(sessionId) : null;
    templatesRef.current = new Map((persistedRef.current?.groups ?? []).map((g) => [g.id, g.panes ?? fromMosaic({ mode: g.mode, preset: g.preset, ratios: g.ratios, tabIds: g.artifacts })]));
    if (persistedRef.current?.closed) setState((s) => ({ ...s, closed: persistedRef.current?.closed ?? [] }));
  }, [sessionId]);

  /** Windows in their own OS window: closed here, but they keep their group and their tab. */
  const ghosts = useMemo(() => {
    const out = new Set<number>();
    for (const w of api.windows) if (w.closed && w.artifactId && api.nativeIds.has(w.artifactId)) out.add(w.id);
    return out as ReadonlySet<number>;
  }, [api.windows, api.nativeIds]);

  // Assign new windows to a group, record closes, and drop windows that are gone.
  useEffect(() => {
    const windows = api.windows;
    let next = stateRef.current;
    const known = new Set<number>();
    for (const g of next.groups) for (const id of g.windowIds) known.add(id);
    const alive = new Set(windows.map((w) => w.id));

    for (const w of windows) {
      const inGroup = known.has(w.id);
      if (w.closed) {
        if (inGroup && !ghosts.has(w.id)) {
          const g = groupOf(next, w.id);
          next = recordClosed(next, { windowId: w.id, artifactId: w.artifactId, title: w.title, type: w.type, groupId: g?.id ?? null, closedAt: Date.now(), saved: false });
          next = detach(next, w.id);
        }
        continue;
      }
      if (inGroup) continue;
      next = forgetClosed(next, w.id);
      const ev = w.content as ArtifactEvent | null;
      const now = Date.now();
      // 1. The core names the task.
      if (ev?.group) {
        const gid = `core:${ev.group}`;
        if (next.groups.some((g) => g.id === gid)) next = assign(next, w.id, gid, now);
        else next = createGroup(next, ev.group_title || w.title, [w.id], { id: gid }, now).state;
      } else {
        // 2. It had a group last time (saved layout or a reopen).
        const remembered = w.artifactId ? pendingGroupRef.current.get(w.artifactId) ?? persistedRef.current?.groups.find((g) => g.artifacts.includes(w.artifactId!)) : undefined;
        const rememberedId = typeof remembered === "string" ? remembered : remembered?.id;
        const sameTurn = [...windowTurn.current.entries()].reverse().find(([id, turn]) => turn === turnRef.current && isTurnActive && groupOf(next, id));
        const current = pickActive(next);
        const currentVisible = current && current.windowIds.some((id) => { const x = windows.find((y) => y.id === id); return x && isOpen(x) && !x.minimized; });
        if (rememberedId && next.groups.some((g) => g.id === rememberedId)) {
          next = assign(next, w.id, rememberedId, now);
        } else if (rememberedId && typeof remembered !== "string" && remembered) {
          next = createGroup(next, remembered.title, [w.id], { id: remembered.id, color: remembered.color }, now).state;
        } else if (sameTurn) {
          next = assign(next, w.id, groupOf(next, sameTurn[0])!.id, now);
        } else if (current && currentVisible) {
          next = assign(next, w.id, current.id, now);
        } else {
          next = createGroup(next, taskTitleRef.current || w.title, [w.id], {}, now).state;
        }
        if (w.artifactId) pendingGroupRef.current.delete(w.artifactId);
        // A window coming back to its saved group takes its place in the saved panes.
        const tpl = rememberedId ? templatesRef.current.get(rememberedId) : undefined;
        if (tpl && rememberedId && w.artifactId) {
          const byArtifact = new Map(windows.filter((x) => x.artifactId).map((x) => [x.artifactId!, x.id]));
          next = setGroupPanes(next, rememberedId, (_tree, g) => reconcile(mapTabs(tpl, (a) => { const id = byArtifact.get(a); return id != null && g.windowIds.includes(id) ? id : undefined; }), g.windowIds, null));
        }
      }
      windowTurn.current.set(w.id, turnRef.current);
      const g = groupOf(next, w.id);
      if (g && !w.minimized && !w.closed) next = activate(next, g.id, now);
      lastUsedRef.current.set(w.id, now);
    }
    for (const g of next.groups) for (const id of g.windowIds) if (!alive.has(id)) next = detach(next, id);
    if (next !== stateRef.current) setState(next);
  }, [api.windows, isTurnActive, ghosts]);

  // Saved layout restores the active group once its windows are back.
  useEffect(() => {
    const p = persistedRef.current;
    if (!p?.active || state.activeGroupId) return;
    if (state.groups.some((g) => g.id === p.active)) setState((s) => activate(s, p.active));
  }, [state.groups, state.activeGroupId]);

  // Content updates count as use: the window Kali touches comes to the front without moving others.
  const contentSig = useRef(new Map<number, unknown>());
  useEffect(() => {
    let touched: WindowData | null = null;
    for (const w of api.windows) {
      if (w.closed) continue;
      const prev = contentSig.current.get(w.id);
      if (prev !== undefined && prev !== w.content && w.content != null) touched = w;
      contentSig.current.set(w.id, w.content);
    }
    if (touched) {
      lastUsedRef.current.set(touched.id, Date.now());
      if (hubRef.current?.current) return;
      const g = groupOf(stateRef.current, touched.id);
      if (g && g.id === stateRef.current.activeGroupId && !touched.minimized && !touched.focused) apiRef.current.focusWindow(touched.id);
    }
  }, [api.windows]);

  // Persist per session.
  useEffect(() => {
    if (!sessionId) return;
    const artifactOf = (id: number) => windowsRef.current.find((w) => w.id === id)?.artifactId;
    save(sessionId, { ...toPersisted(state, artifactOf), closed: state.closed.filter((c) => c.artifactId) });
  }, [state, sessionId]);

  const active = useMemo(() => pickActive(state), [state]);

  const winById = useCallback((id: number) => windowsRef.current.find((w) => w.id === id), []);
  const openIds = useCallback((g: Group | undefined) => (g ? g.windowIds.filter((id) => { const w = winById(id); return !!w && isOpen(w); }) : []), [winById]);

  /** Tabs of the active group that are open here. */
  const tabIds = useMemo(() => openIds(active), [active, openIds, api.windows]);
  /** The active group's tabs as the panes keep them: the open ones and the ghosts, in group order. */
  const paneIds = useMemo(
    () => (active ? active.windowIds.filter((id) => { const w = winById(id); return !!w && (isOpen(w) || ghosts.has(id)); }) : []),
    [active, winById, ghosts, api.windows],
  );

  /** Desktop: close a window's OS window and bring it back to its tab. */
  const bring = useCallback((id: number) => {
    const w = winById(id);
    const sid = localStorage.getItem("kali.sessionId");
    if (w?.artifactId && sid) void window.kaliDesktop?.bringArtifact?.(sid, w.artifactId);
  }, [winById]);
  /** Its own window on the desktop (it stays here as a ghost); a browser tab on the web. */
  const detachWindow = useCallback((id: number) => {
    const w = winById(id);
    const sid = localStorage.getItem("kali.sessionId");
    if (!w?.artifactId || !sid) return;
    if (isDesktop()) void window.kaliDesktop?.openArtifact(sid, w.artifactId, w.type);
    else window.open(artifactPageUrl(sid, w.artifactId), "_blank", "noopener");
  }, [winById]);
  const ghostsRef = useRef(ghosts);
  ghostsRef.current = ghosts;

  // ── Actions ─────────────────────────────────────────────

  const focusWindow = useCallback((id: number) => {
    const w = winById(id);
    if (!w) return;
    // A ghost lives in its own window: choosing it brings it back (it reopens focused).
    if (ghostsRef.current.has(id)) { bring(id); return; }
    if (w.closed) { apiRef.current.restoreWindow(id); }
    else if (w.minimized) apiRef.current.toggleMinimize(id);
    apiRef.current.focusWindow(id);
    setState((s) => setActiveTab(s, id));
    setBoard(false);
    touch(id);
  }, [winById, touch, bring]);

  // A window focused from outside the canvas (the library, "back to canvas" from a native
  // window, a link) comes onto the screen: out of the tray, its group active, its tab chosen.
  const lastFocusRef = useRef<number | null>(null);
  useEffect(() => {
    const f = api.windows.find((w) => w.focused && !w.closed);
    const id = f?.id ?? null;
    if (id === lastFocusRef.current) return;
    lastFocusRef.current = id;
    if (!f) return;
    const g = groupOf(stateRef.current, f.id);
    // Off screen: in the tray, in another group, or not its group's chosen tab (one back from its own window).
    const offScreen = f.minimized || (g != null && (g.id !== stateRef.current.activeGroupId || g.activeId !== f.id));
    if (!offScreen) return;
    if (g && g.id !== stateRef.current.activeGroupId) openGroupRef.current?.(g.id);
    focusWindow(f.id);
  }, [api.windows, focusWindow]);

  /** Show a group: its tabs come back from the tray and it becomes the active one. */
  const openGroup = useCallback((groupId: string) => {
    const g = stateRef.current.groups.find((x) => x.id === groupId);
    if (!g) return;
    const ids = g.windowIds.filter((id) => { const w = winById(id); return w && isOpen(w); });
    const ranked = [...ids].sort((a, b) => lastUsed(b) - lastUsed(a));
    for (const id of ranked) { const w = winById(id); if (w?.minimized) apiRef.current.toggleMinimize(id); }
    // Other groups' windows step back to the tray so only one task is on screen.
    for (const other of stateRef.current.groups) {
      if (other.id === groupId) continue;
      for (const id of other.windowIds) { const w = winById(id); if (w && isOpen(w) && !w.minimized && !other.pinnedIds.includes(id)) apiRef.current.toggleMinimize(id); }
    }
    if (ranked[0] != null) apiRef.current.focusWindow(ranked[0]);
    setState((s) => activate(s, groupId));
    setBoard(false);
  }, [winById, lastUsed]);

  const openGroupRef = useRef(openGroup);
  openGroupRef.current = openGroup;

  const minimize = useCallback((id: number) => {
    const w = winById(id);
    if (w && !w.minimized) apiRef.current.toggleMinimize(id);
  }, [winById]);

  const close = useCallback((id: number) => { apiRef.current.closeWindow(id); }, []);

  /** Put a whole group away: its windows close into "Saved", pinned ones stay. */
  const saveGroup = useCallback((groupId: string, onlyIds?: number[]) => {
    const g = stateRef.current.groups.find((x) => x.id === groupId);
    if (!g) return;
    let next = stateRef.current;
    for (const id of onlyIds ?? g.windowIds) {
      if (!onlyIds && g.pinnedIds.includes(id)) continue;
      const w = winById(id);
      if (!w) continue;
      next = recordClosed(next, { windowId: id, artifactId: w.artifactId, title: w.title, type: w.type, groupId: g.id, closedAt: Date.now(), saved: true });
      next = detach(next, id);
      apiRef.current.closeWindow(id);
    }
    setState(next);
  }, [winById]);

  /** Save specific windows wherever they are (the tray's "put away unused" offer). */
  const saveWindows = useCallback((ids: number[]) => {
    let next = stateRef.current;
    for (const id of ids) {
      const w = winById(id);
      if (!w) continue;
      const g = groupOf(next, id);
      next = recordClosed(next, { windowId: id, artifactId: w.artifactId, title: w.title, type: w.type, groupId: g?.id ?? null, closedAt: Date.now(), saved: true });
      next = detach(next, id);
      apiRef.current.closeWindow(id);
    }
    setState(next);
  }, [winById]);

  const reopen = useCallback((entry: ClosedEntry) => {
    if (entry.groupId && entry.artifactId) pendingGroupRef.current.set(entry.artifactId, entry.groupId);
    const w = winById(entry.windowId);
    if (w && w.closed) {
      if (entry.groupId && stateRef.current.groups.some((g) => g.id === entry.groupId)) {
        setState((s) => forgetClosed(assign(s, entry.windowId, entry.groupId!), entry.windowId));
      }
      apiRef.current.restoreWindow(entry.windowId);
    } else if (entry.artifactId) {
      apiRef.current.reopenArtifact(entry.artifactId);
    }
    setState((s) => forgetClosed(s, entry.windowId));
    // Reopened from the tray or Espacio: the window comes back on screen, not under them.
    setBoard(false);
  }, [winById]);

  const moveToGroup = useCallback((ids: number[], groupId: string | "new", title?: string) => {
    setState((s) => {
      if (groupId === "new") {
        const first = winById(ids[0]);
        return createGroup(s, title || first?.title || "…", ids).state;
      }
      let next = s;
      for (const id of ids) next = assign(next, id, groupId);
      return next;
    });
  }, [winById]);

  const newGroup = useCallback((title: string, ids: number[] = []) => {
    let created = "";
    setState((s) => { const r = createGroup(s, title, ids); created = r.id; return r.state; });
    return created;
  }, []);

  const rename = useCallback((groupId: string, title: string) => setState((s) => renameGroup(s, groupId, title)), []);
  const togglePin = useCallback((id: number) => setState((s) => toggleGroupPin(s, id)), []);
  const reorder = useCallback((id: number, index: number) => setState((s) => reorderGroup(s, id, index)), []);
  /** Change the active group's panes (a drag, a divider, Ctrl+\); the saved tree is no longer waited for. */
  const setPanes = useCallback((fn: (tree: PaneNode) => PaneNode, groupId?: string) => {
    const gid = groupId ?? stateRef.current.activeGroupId;
    if (!gid) return;
    templatesRef.current.delete(gid);
    setState((s) => setGroupPanes(s, gid, fn));
  }, []);
  /** Ctrl+1…4: one, two, three or four panes. */
  const toPreset = useCallback((n: 1 | 2 | 3 | 4) => {
    const g = stateRef.current.groups.find((x) => x.id === stateRef.current.activeGroupId);
    if (!g) return;
    templatesRef.current.delete(g.id);
    setState((s) => zoomGroupPane(setGroupPanes(s, g.id, (tree) => treeToPreset(tree, n)), g.id, null));
    // Windows left in the tray come back as tabs.
    for (const id of g.windowIds) { const w = winById(id); if (w && isOpen(w) && w.minimized) apiRef.current.toggleMinimize(id); }
  }, [winById]);
  const zoomPane = useCallback((leafId: string | null) => {
    const gid = stateRef.current.activeGroupId;
    if (gid) setState((s) => zoomGroupPane(s, gid, leafId));
  }, []);
  const activateGroup = useCallback((groupId: string | null) => setState((s) => activate(s, groupId)), []);

  return {
    groups: state,
    active,
    tabIds,
    paneIds,
    ghosts,
    bring,
    detachWindow,
    board, setBoard,
    lastUsed,
    focusWindow,
    openGroup,
    activateGroup,
    minimize,
    close,
    saveGroup,
    saveWindows,
    reopen,
    moveToGroup,
    newGroup,
    rename,
    togglePin,
    reorder,
    setPanes,
    toPreset,
    zoomPane,
  };
}

export type CanvasStateApi = ReturnType<typeof useCanvasState>;
