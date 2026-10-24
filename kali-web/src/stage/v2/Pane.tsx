/**
 * stage/v2/Pane.tsx — The Studio's panes: a row of tabs over each pane, the dividers between
 * them, and dragging a tab to another pane or to a pane's edge.
 *
 *   ┌ [▤ Plan ×] [</> styles.css] ─────────── [actions] ⤢ ┐   40 px row of tabs: icon, title,
 *   │                                                     │   status dot, × on hover; the
 *   │  the active tab's window (WindowLayer places it)    │   widget's actions and Maximize
 *   │                                                     │   at the right
 *   └──────────────────────────────── footer 28 px ───────┘
 *
 * The windows are not children: WindowLayer gives the active tab of each pane the rectangle under
 * its row (studioView), so a window never unmounts when it moves between panes. Tabs drag with
 * Pointer Events (HTML5 drag fails in Electron under Wayland): a press that moves 6 px picks the
 * tab up, the pane under the pointer shows where it would land (its middle, an edge, or a place
 * in its row) and letting go moves it there.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2, X } from "lucide-react";
import type { WindowData } from "../../workspace/types";
import type { Group } from "../../workspace/groups";
import { PANE_TABS_H, type Rect } from "../../workspace/layout";
import {
  PANES_MIN_STAGE_W, dropRect, dropZone, leaves, moveTab, paneLayout, reconcile, setRatio, singleLeaf, splitAt,
  type DropSide, type PaneDivider, type PaneNode,
} from "../../workspace/panes";
import { WindowTypeIcon } from "../windowIcons";
import type { CanvasStateApi } from "./useCanvasState";
import type { ShellStatus } from "./shell";

export interface StudioLeaf { id: string; rect: Rect; tabIds: number[]; activeId: number | null }
export interface StudioView {
  tree: PaneNode;
  leaves: StudioLeaf[];
  dividers: PaneDivider[];
  /** One pane on screen: narrow window, a single pane, or a maximized one. */
  single: boolean;
  zoomed: boolean;
  /** The pane of the tab you are on. */
  activeLeaf: string | null;
}

/** What the Studio paints for a group in `area`: the tree reconciled with its open tabs. */
export function studioView(g: Group, tabIds: number[], area: Rect, k: number, stageW: number): StudioView {
  const active = g.activeId != null && tabIds.includes(g.activeId) ? g.activeId : tabIds[0] ?? null;
  const narrow = stageW < PANES_MIN_STAGE_W;
  const full = reconcile(g.panes, tabIds, active);
  const zoomedLeaf = !narrow && g.zoomed ? leaves(full).find((l) => l.id === g.zoomed) : undefined;
  const tree: PaneNode = narrow ? singleLeaf(tabIds, active) : zoomedLeaf ?? full;
  const pl = paneLayout(area, tree, k);
  const byId = new Map(leaves(tree).map((l) => [l.id, l]));
  const ls = pl.leaves.map((x) => ({ id: x.id, rect: x.rect, tabIds: byId.get(x.id)!.tabIds, activeId: byId.get(x.id)!.activeId }));
  return {
    tree: full,
    leaves: ls,
    dividers: pl.dividers,
    single: ls.length === 1,
    zoomed: !!zoomedLeaf,
    activeLeaf: ls.find((l) => active != null && l.tabIds.includes(active))?.id ?? ls[0]?.id ?? null,
  };
}

/** The rectangle of a pane's window: the pane without its row of tabs. */
export const paneBody = (r: Rect, k: number): Rect => ({ x: r.x + 1, y: r.y + PANE_TABS_H * k, w: r.w - 2, h: r.h - PANE_TABS_H * k - 1 });

const DOT: Record<string, string> = { permission: "is-permission", writing: "is-working", updating: "is-working", running: "is-working", done: "is-ready", saved: "is-ready", error: "is-error" };
const box = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

type Over = { leafId: string; zone: "center" | DropSide } | { leafId: string; index: number; before: number | null };
interface Drag { tabId: number; x: number; y: number; over: Over | null }

export function StudioPanes({ canvas, view, windows, status, k, onHost, extra }: {
  canvas: CanvasStateApi;
  view: StudioView;
  windows: WindowData[];
  status: Map<number, ShellStatus | null>;
  k: number;
  /** The element where the active tab's widget puts its header actions. */
  onHost: (leafId: string, el: HTMLElement | null) => void;
  /** More buttons for a pane's active tab (its own window, on the desktop). */
  extra?: (activeId: number) => ReactNode;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  const rootRect = () => document.querySelector(".v2-root")?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const viewRef = useRef(view);
  viewRef.current = view;
  // One stable ref callback per pane, so the host element is reported once, not on every render.
  const hostRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const hostRef = (id: string) => {
    let fn = hostRefs.current.get(id);
    if (!fn) { fn = (el) => onHost(id, el); hostRefs.current.set(id, fn); }
    return fn;
  };

  const overAt = useCallback((x: number, y: number): Over | null => {
    const leaf = viewRef.current.leaves.find((l) => x >= l.rect.x && x <= l.rect.x + l.rect.w && y >= l.rect.y && y <= l.rect.y + l.rect.h);
    if (!leaf) return null;
    if (y < leaf.rect.y + PANE_TABS_H * k) {
      // Over the row of tabs: a place between tabs.
      const tabs = Array.from(document.querySelectorAll<HTMLElement>(`[data-pane="${leaf.id}"] [data-tab-id]`));
      const o = rootRect();
      let index = tabs.length;
      let before: number | null = null;
      for (let i = 0; i < tabs.length; i++) {
        const r = tabs[i].getBoundingClientRect();
        if (x < r.left - o.left + r.width / 2) { index = i; before = Number(tabs[i].dataset.tabId); break; }
      }
      return { leafId: leaf.id, index, before };
    }
    if (viewRef.current.single && viewRef.current.zoomed) return { leafId: leaf.id, zone: "center" };
    return { leafId: leaf.id, zone: dropZone(paneBody(leaf.rect, k), x, y) };
  }, [k]);

  /** Press on a tab: a click chooses it; moving 6 px picks it up. */
  const onTabDown = (tabId: number) => (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".v2-tab-close")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!started) { started = true; try { el.setPointerCapture(ev.pointerId); } catch { /* gone */ } }
      const o = rootRect();
      const x = ev.clientX - o.left;
      const y = ev.clientY - o.top;
      setDrag({ tabId, x, y, over: overAt(x, y) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (!started) return;
      const o = rootRect();
      const over = overAt(ev.clientX - o.left, ev.clientY - o.top);
      setDrag(null);
      if (!over) return;
      if ("index" in over) canvas.setPanes((tree) => moveTab(tree, tabId, over.leafId, over.index));
      else if (over.zone === "center") canvas.setPanes((tree) => moveTab(tree, tabId, over.leafId));
      else { canvas.zoomPane(null); canvas.setPanes((tree) => splitAt(tree, over.leafId, over.zone as DropSide, tabId)); }
      canvas.focusWindow(tabId);
    };
    const cancel = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); setDrag(null); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // Esc drops a drag where it started.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDrag(null); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag]);

  const startResize = (d: PaneDivider) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setResizing(d.id);
    const o = rootRect();
    const move = (ev: PointerEvent) => {
      const v = d.dir === "row" ? (ev.clientX - o.left - d.span.x) / d.span.w : (ev.clientY - o.top - d.span.y) / d.span.h;
      canvas.setPanes((tree) => setRatio(tree, d.id, Math.min(d.max, Math.max(d.min, v))));
    };
    const up = () => { setResizing(null); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragged = drag ? windows.find((w) => w.id === drag.tabId) : undefined;
  const overLeaf = drag?.over ? view.leaves.find((l) => l.id === drag.over!.leafId) : undefined;

  return (
    <>
      {view.leaves.map((leaf) => {
        const focused = leaf.id === view.activeLeaf;
        const tabs = leaf.tabIds.map((id) => windows.find((w) => w.id === id && !w.closed)).filter((w): w is WindowData => !!w);
        return (
          <section key={leaf.id} className={`v2-pane ${focused ? "is-focused" : ""}`} style={box(leaf.rect)} data-pane={leaf.id}>
            <div className="v2-pane-tabs" style={{ height: PANE_TABS_H * k }}>
              <div className="v2-tablist" role="tablist" aria-label={t("v2.pane.tabs") as string}>
                {tabs.map((w, i) => {
                  const st = status.get(w.id);
                  const selected = w.id === leaf.activeId;
                  const dropBefore = drag?.over && "index" in drag.over && drag.over.leafId === leaf.id && drag.over.before === w.id;
                  return (
                    <div
                      key={w.id}
                      id={`v2-tab-${w.id}`}
                      data-tab-id={w.id}
                      role="tab"
                      tabIndex={selected ? 0 : -1}
                      aria-selected={selected}
                      className={`v2-tab ${dropBefore ? "is-drop-before" : ""} ${drag?.tabId === w.id ? "is-dragged" : ""}`}
                      onPointerDown={onTabDown(w.id)}
                      onClick={() => canvas.focusWindow(w.id)}
                      onKeyDown={(e) => {
                        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                        e.preventDefault();
                        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                        if (next) { canvas.focusWindow(next.id); document.getElementById(`v2-tab-${next.id}`)?.focus(); }
                      }}
                      onAuxClick={(e) => { if (e.button === 1) canvas.close(w.id); }}
                      title={w.title}
                    >
                      <WindowTypeIcon type={w.type} size={14} />
                      <span className="truncate" style={{ maxWidth: "calc(180px * var(--k))" }}>{w.title}</span>
                      {st && <span className={`v2-dot ${DOT[st.kind] ?? ""}`} aria-label={t(`v2.status.${st.kind}`) as string} />}
                      <button type="button" className="v2-tab-close" onClick={(e) => { e.stopPropagation(); canvas.close(w.id); }} aria-label={t("v2.tabs.close", { title: w.title }) as string}>
                        <X size={12} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <span className="v2-pane-actions" ref={hostRef(leaf.id)} />
              {leaf.activeId != null && extra?.(leaf.activeId)}
              {(view.leaves.length > 1 || view.zoomed) && (
                <button
                  type="button"
                  className="v2-icon-btn"
                  onClick={() => { if (leaf.activeId != null) canvas.focusWindow(leaf.activeId); canvas.zoomPane(view.zoomed ? null : leaf.id); }}
                  aria-label={t(view.zoomed ? "v2.pane.restore" : "v2.pane.maximize") as string}
                  title={t(view.zoomed ? "v2.pane.restore" : "v2.pane.maximize") as string}
                >
                  {view.zoomed ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                </button>
              )}
            </div>
          </section>
        );
      })}

      {view.dividers.map((d) => (
        <div
          key={d.id}
          className={`v2-divider ${d.dir === "row" ? "is-vertical" : "is-horizontal"} ${resizing === d.id ? "is-dragging" : ""}`}
          style={box(d.dir === "row" ? { ...d.rect, x: d.rect.x - 4, w: d.rect.w + 8 } : { ...d.rect, y: d.rect.y - 4, h: d.rect.h + 8 })}
          role="separator"
          aria-orientation={d.dir === "row" ? "vertical" : "horizontal"}
          aria-valuemin={Math.round(d.min * 100)}
          aria-valuemax={Math.round(d.max * 100)}
          aria-valuenow={Math.round(d.ratio * 100)}
          aria-label={t("v2.mosaic.divider") as string}
          tabIndex={0}
          onPointerDown={startResize(d)}
          onDoubleClick={() => canvas.setPanes((tree) => setRatio(tree, d.id, 0.5))}
          onKeyDown={(e) => {
            const dec = d.dir === "row" ? "ArrowLeft" : "ArrowUp";
            const inc = d.dir === "row" ? "ArrowRight" : "ArrowDown";
            if (e.key === dec || e.key === inc) { e.preventDefault(); canvas.setPanes((tree) => setRatio(tree, d.id, Math.min(d.max, Math.max(d.min, d.ratio + (e.key === inc ? 0.02 : -0.02))))); }
            if (e.key === "Enter" || e.key === "Home") { e.preventDefault(); canvas.setPanes((tree) => setRatio(tree, d.id, 0.5)); }
          }}
        />
      ))}

      {drag && overLeaf && drag.over && !("index" in drag.over) && (
        <div className="v2-drop-zone" style={box(dropRect(paneBody(overLeaf.rect, k), drag.over.zone))} />
      )}
      {drag && dragged && (
        <div className="v2-tab-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }} aria-hidden="true">
          <WindowTypeIcon type={dragged.type} size={14} />
          <span className="truncate">{dragged.title}</span>
        </div>
      )}
    </>
  );
}
