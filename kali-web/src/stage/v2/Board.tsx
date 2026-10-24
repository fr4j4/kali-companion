/**
 * stage/v2/Board.tsx — The board: every artifact of the session as a card, to look and choose.
 *
 * One view replaces the overview, the tray and Espacio. Each group is a zone with its name and
 * colour and a grid of cards (miniature, title, type, last use); the world zooms with the wheel
 * (25 % to 100 %) and pans by dragging the background. A double click (or Enter) opens a card where
 * the mode shows it: the active pane in the Studio, the lámina in the Hub. A card dragged to
 * another zone changes group (to the dashed zone, a new one); the context menu opens, pins, saves
 * or closes it, and a zone's name renames with a double click. "Recently closed" is the row at the
 * foot. Esc goes back.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Archive, FolderPlus, Maximize, Minus, Pin, Plus, RotateCcw } from "lucide-react";
import type { WindowData, WindowType } from "../../workspace/types";
import type { ClosedEntry, Group } from "../../workspace/groups";
import { WindowTypeIcon } from "../windowIcons";
import type { CanvasStateApi } from "./useCanvasState";
import { groupVar } from "./GroupChrome";
import { formatAgo } from "./useRelativeTime";
import { useDismiss } from "./Hud";
import { NEW_ZONE, ZONE_HEAD, boardLayout, fitBoard, zoneAt, zoomAround } from "./boardLayout";

// ── Miniature ───────────────────────────────────────────

/** A few deterministic widths so each miniature looks a little different. */
const widths = (seed: number, n: number) => Array.from({ length: n }, (_, i) => 38 + ((seed * 37 + i * 53) % 55));

export function Miniature({ type, seed = 0, style }: { type: WindowType | string; seed?: number; style?: CSSProperties }) {
  const w = widths(seed, 5);
  const line = (pct: number, cls = "", key?: number) => <i key={key} className={cls} style={{ width: `${pct}%` }} />;
  let body;
  if (type === "chart") {
    body = <div className="bars">{w.map((p, i) => <b key={i} style={{ height: `${p}%` }} />)}</div>;
  } else if (type === "table") {
    body = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {Array.from({ length: 12 }, (_, i) => <i key={i} className={i < 4 ? "c2" : ""} />)}
      </div>
    );
  } else if (type === "html" || type === "image" || type === "media" || type === "game") {
    body = <>{<div className="block" style={{ height: type === "image" ? 38 : 22 }} />}{line(w[0])}{line(w[1] - 10)}</>;
  } else if (type === "code" || type === "terminal" || type === "json" || type === "diff") {
    body = <>{line(w[0] - 20, "c1", 0)}{line(w[1], "", 1)}{line(w[2] - 15, type === "diff" ? "c3" : "c2", 2)}{line(w[3], "", 3)}</>;
  } else if (type === "checklist" || type === "quiz") {
    body = <>{w.slice(0, 4).map((p, i) => <span key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}><i className={i === 0 ? "c3" : ""} style={{ width: 8, height: 8 }} /><i style={{ width: `${p}%` }} /></span>)}</>;
  } else {
    body = <>{line(55, "c1", 0)}{w.slice(0, 4).map((p, i) => line(p, "", i + 1))}</>;
  }
  return <div className="v2-mini" style={style} aria-hidden="true">{body}</div>;
}

// ── Board ───────────────────────────────────────────────

const box = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

interface Props {
  canvas: CanvasStateApi;
  windows: WindowData[];
  /** Open a card where the mode shows it (the active pane, the lámina). */
  onOpen: (windowId: number) => void;
  onClose: () => void;
}

export function Board({ canvas, windows, onOpen, onClose }: Props) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 1200, h: 700 });
  const [view, setView] = useState<{ zoom: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; zone: string | null } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(!!menu, () => setMenu(null), menuRef);

  const open = (w: WindowData | undefined): w is WindowData => !!w && !w.closed;
  const byId = useCallback((id: number) => windows.find((w) => w.id === id), [windows]);
  const groups = canvas.groups.groups;
  const layout = useMemo(
    // Zones wrap at the viewport's width, so at 100 % the board reads top to bottom.
    () => boardLayout(groups.map((g) => ({ id: g.id, cardIds: g.windowIds.filter((id) => open(byId(id))) })), Math.max(1100, vp.w - 80)),
    [groups, byId, vp.w],
  );

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { rootRef.current?.focus(); }, []);

  // Until the person zooms or pans, the view follows the board and always fits it.
  const fit = fitBoard(layout.size, vp);
  const v = view ?? fit;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const toWorld = (cx: number, cy: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  };

  // Wheel zooms around the pointer (the page never scrolls behind the board).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((cur) => zoomAround(cur ?? fitRef.current, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => setView((cur) => zoomAround(cur ?? fitRef.current, factor, vp.w / 2, vp.h / 2));

  /** Background press: pan. */
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".v2-bcard, .v2-bzone-head, button, input")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = v;
    setSelected(null);
    const move = (ev: PointerEvent) => setView({ ...start, x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Card press: select; moving 6 px picks it up to change its group. */
  const onCardDown = (id: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setSelected(id);
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const el = e.currentTarget as HTMLElement;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!started) { started = true; try { el.setPointerCapture(ev.pointerId); } catch { /* gone */ } }
      const r = viewportRef.current!.getBoundingClientRect();
      const w = toWorld(ev.clientX, ev.clientY);
      setDrag({ id, x: ev.clientX - r.left, y: ev.clientY - r.top, zone: zoneAt(layout, w.x, w.y)?.id ?? null });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!started) return;
      const w = toWorld(ev.clientX, ev.clientY);
      const zone = zoneAt(layout, w.x, w.y);
      setDrag(null);
      const from = groups.find((g) => g.windowIds.includes(id));
      if (!zone || zone.id === from?.id) return;
      canvas.moveToGroup([id], zone.id === NEW_ZONE ? "new" : zone.id);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const openCard = (id: number) => { onOpen(id); onClose(); };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); if (menu) setMenu(null); else onClose(); return; }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.2); }
    if (e.key === "-") { e.preventDefault(); zoomBy(1 / 1.2); }
    if (e.key === "0") { e.preventDefault(); setView(null); }
  };

  const groupById = (id: string): Group | undefined => groups.find((g) => g.id === id);
  const menuWin = menu ? byId(menu.id) : undefined;
  const menuGroup = menu ? groups.find((g) => g.windowIds.includes(menu.id)) : undefined;
  const dragged = drag ? byId(drag.id) : undefined;
  const closed = canvas.groups.closed;

  return (
    <div ref={rootRef} className="v2-board v2-enter" role="dialog" aria-modal="true" aria-label={t("v2.board.title") as string} tabIndex={-1} onKeyDown={onKey}>
      <header className="v2-board-head">
        <h1>{t("v2.board.title")}</h1>
        <span className="v2-space-hint">{t("v2.board.hint")}</span>
        <span className="flex-1" />
        <div className="v2-board-zoom" role="group" aria-label={t("v2.board.zoom") as string}>
          <button type="button" className="v2-icon-btn" onClick={() => zoomBy(1 / 1.2)} aria-label={t("v2.board.zoom_out") as string} title={t("v2.board.zoom_out") as string}><Minus size={16} /></button>
          <span className="v2-board-pct">{Math.round(v.zoom * 100)} %</span>
          <button type="button" className="v2-icon-btn" onClick={() => zoomBy(1.2)} aria-label={t("v2.board.zoom_in") as string} title={t("v2.board.zoom_in") as string}><Plus size={16} /></button>
          <button type="button" className="v2-icon-btn" onClick={() => setView(null)} aria-label={t("v2.board.fit") as string} title={`${t("v2.board.fit")} · 0`}><Maximize size={16} /></button>
        </div>
        <button type="button" className="v2-btn" onClick={onClose}>{t("v2.space.done")}<span className="v2-kbd">Esc</span></button>
      </header>

      <div ref={viewportRef} className={`v2-board-view ${drag ? "is-dragging" : ""}`} onPointerDown={onBackgroundDown}>
        <div className="v2-board-world" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`, width: layout.size.w, height: layout.size.h }}>
          {layout.zones.map((z) => {
            const g = groupById(z.id);
            const isNew = z.id === NEW_ZONE;
            const active = g && g.id === canvas.groups.activeGroupId;
            return (
              <section
                key={z.id}
                className={`v2-bzone ${isNew ? "is-new" : ""} ${drag?.zone === z.id ? "is-drop" : ""} ${active ? "is-active" : ""}`}
                style={{ ...box(z.rect), ["--gc" as string]: g ? groupVar(g) : "var(--muted)" }}
                aria-label={g?.title ?? (t("v2.space.new_group") as string)}
              >
                <div className="v2-bzone-head" style={{ height: ZONE_HEAD }}>
                  {isNew ? (
                    <><FolderPlus size={16} aria-hidden="true" /><span>{t("v2.space.new_drop")}</span></>
                  ) : renaming === z.id ? (
                    <input
                      autoFocus
                      defaultValue={g!.title}
                      aria-label={t("v2.space.rename") as string}
                      onBlur={(e) => { canvas.rename(z.id, e.currentTarget.value.trim() || g!.title); setRenaming(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                    />
                  ) : (
                    <>
                      <span className="v2-swatch" aria-hidden="true" />
                      <h3 onDoubleClick={() => setRenaming(z.id)} title={t("v2.space.rename_hint") as string}>{g!.title}</h3>
                      <span className="v2-kbd">{z.cards.length}</span>
                      {active && <span className="v2-chip">{t("v2.tray.on_screen")}</span>}
                    </>
                  )}
                </div>
                {z.cards.map((c) => {
                  const w = byId(c.id)!;
                  const pinned = g?.pinnedIds.includes(w.id);
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected === w.id}
                      className={`v2-bcard ${selected === w.id ? "is-selected" : ""} ${drag?.id === w.id ? "is-dragged" : ""}`}
                      style={box({ x: c.rect.x - z.rect.x, y: c.rect.y - z.rect.y, w: c.rect.w, h: c.rect.h })}
                      onPointerDown={onCardDown(w.id)}
                      onDoubleClick={() => openCard(w.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openCard(w.id);
                        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ id: w.id, x: r.left + 20, y: r.top + 20 }); }
                      }}
                      onContextMenu={(e) => { e.preventDefault(); setSelected(w.id); setMenu({ id: w.id, x: e.clientX, y: e.clientY }); }}
                      title={w.title}
                    >
                      <Miniature type={w.type} seed={w.id} />
                      <div className="v2-bcard-foot">
                        <WindowTypeIcon type={w.type} size={16} />
                        <span className="min-w-0 flex-1">
                          <strong>{w.title}</strong>
                          <small>
                            {pinned && <Pin size={11} aria-label={t("v2.space.pinned") as string} />}
                            {t(`v2.type.${w.type}`, { defaultValue: w.type })} · {formatAgo(Date.now() - (canvas.lastUsed(w.id) || Date.now()))}
                          </small>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
        {drag && dragged && (
          <div className="v2-tab-ghost" style={{ left: drag.x + 12, top: drag.y + 10 }} aria-hidden="true">
            <WindowTypeIcon type={dragged.type} size={14} />
            <span className="truncate">{dragged.title}</span>
          </div>
        )}
      </div>

      {closed.length > 0 && <Recents closed={closed} onReopen={(c) => canvas.reopen(c)} />}

      {menu && menuWin && menuGroup && (
        <div ref={menuRef} className="v2-pop" style={{ position: "fixed", left: menu.x, top: menu.y }} role="menu">
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { setMenu(null); openCard(menuWin.id); }}>{t("v2.tray.open")}</button>
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { canvas.togglePin(menuWin.id); setMenu(null); }}>{menuGroup.pinnedIds.includes(menuWin.id) ? t("v2.space.unpin") : t("v2.space.pin")}</button>
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { setRenaming(menuGroup.id); setMenu(null); }}>{t("v2.area.rename")} · {menuGroup.title}</button>
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { canvas.moveToGroup([menuWin.id], "new"); setMenu(null); }}>{t("v2.space.new_group")}</button>
          <div className="v2-menu-sep" />
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { canvas.saveWindows([menuWin.id]); setMenu(null); }}><Archive size={16} />{t("v2.tray.save")}</button>
          <button type="button" role="menuitem" className="v2-menu-item is-danger" onClick={() => { canvas.close(menuWin.id); setMenu(null); }}>{t("common.close")}</button>
        </div>
      )}
    </div>
  );
}

/** «Recently closed»: one row at the foot of the board. */
function Recents({ closed, onReopen, max = 8 }: { closed: ClosedEntry[]; onReopen: (e: ClosedEntry) => void; max?: number }) {
  const { t } = useTranslation();
  return (
    <section className="v2-board-recent" aria-label={t("v2.tray.recent") as string}>
      <span className="v2-label">{t("v2.tray.recent")}</span>
      <div className="v2-recent">
        {closed.slice(0, max).map((c) => (
          <div key={`${c.windowId}-${c.closedAt}`} className="v2-recent-item">
            <WindowTypeIcon type={c.type as WindowType} size={16} />
            <span className="min-w-0">
              <strong className="truncate">{c.title}</strong>
              <small>{c.groupTitle ? `${c.groupTitle} · ` : ""}{t(c.saved ? "v2.tray.saved_ago" : "v2.tray.closed_ago", { when: formatAgo(Date.now() - c.closedAt) })}</small>
            </span>
            <button type="button" className="v2-btn is-quiet" onClick={() => onReopen(c)} aria-label={t("v2.tray.reopen_title", { title: c.title }) as string}>
              <RotateCcw size={14} aria-hidden="true" />{t("v2.tray.reopen")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
