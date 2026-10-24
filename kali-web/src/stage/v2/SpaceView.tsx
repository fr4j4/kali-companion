/**
 * stage/v2/SpaceView.tsx — Espacio: put the session's artifacts in order.
 *
 * One column per group (rename with a double click), a column of saved artifacts and a "new
 * group" drop target. Cards drag between columns, select with a click or Space and act in bulk;
 * the context menu has the same actions for one card. Every move, save or close can be undone for
 * a few seconds.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArrowUpRight, Check, FolderPlus, Pin, RotateCcw, Search, X } from "lucide-react";
import type { WindowData, WindowType } from "../../workspace/types";
import type { ClosedEntry, Group } from "../../workspace/groups";
import { WindowTypeIcon } from "../windowIcons";
import type { CanvasStateApi } from "./useCanvasState";
import { groupVar } from "./GroupChrome";
import { Miniature } from "./ZonePanels";
import { formatAgo } from "./useRelativeTime";
import { useDismiss } from "./Hud";

type Filter = "all" | "open" | "tray" | "saved";
const DRAG = "application/x-kali-space";
export const UNDO_MS = 6000;

interface Undo { label: string; run: () => void }

export function SpaceView({ canvas, windows, onClose }: { canvas: CanvasStateApi; windows: WindowData[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(!!menu, () => setMenu(null), menuRef);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  useEffect(() => { rootRef.current?.querySelector<HTMLElement>("input")?.focus(); }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const needle = q.trim().toLowerCase();
  const byId = useCallback((id: number) => windows.find((w) => w.id === id), [windows]);
  const visible = (w: WindowData | undefined): w is WindowData => {
    if (!w || w.closed) return false;
    if (filter === "saved") return false;
    if (filter === "open" && w.minimized) return false;
    if (filter === "tray" && !w.minimized) return false;
    return !needle || w.title.toLowerCase().includes(needle);
  };
  const saved = canvas.groups.closed.filter((c) => (filter === "all" || filter === "saved") && (!needle || c.title.toLowerCase().includes(needle)));

  const groupOfId = useCallback((id: number) => canvas.groups.groups.find((g) => g.windowIds.includes(id)), [canvas.groups.groups]);

  // ── Actions with undo ──
  const move = useCallback((ids: number[], target: string | "new", title?: string) => {
    const before = ids.map((id) => ({ id, g: groupOfId(id) }));
    canvas.moveToGroup(ids, target, title);
    setSelected([]);
    setUndo({
      label: t("v2.space.moved", { count: ids.length }),
      run: () => { for (const b of before) if (b.g) canvasRef.current.moveToGroup([b.id], canvasRef.current.groups.groups.some((g) => g.id === b.g!.id) ? b.g.id : "new", b.g.title); },
    });
  }, [canvas, groupOfId, t]);

  const putAway = useCallback((ids: number[], how: "save" | "close") => {
    if (how === "save") canvas.saveWindows(ids); else ids.forEach((id) => canvas.close(id));
    setSelected([]);
    setUndo({
      label: t(how === "save" ? "v2.space.saved_n" : "v2.space.closed_n", { count: ids.length }),
      run: () => {
        // The entries are in "recently closed" by now; reopen them in their group.
        for (const id of ids) {
          const entry = canvasRef.current.groups.closed.find((c) => c.windowId === id);
          if (entry) canvasRef.current.reopen(entry);
        }
      },
    });
  }, [canvas, t]);

  const toggleSelect = (id: number) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const dragIds = (id: number) => (selected.includes(id) ? selected : [id]);
  const onDragStart = (id: number) => (e: DragEvent) => { e.dataTransfer.setData(DRAG, JSON.stringify(dragIds(id))); e.dataTransfer.effectAllowed = "move"; };
  const dropProps = (key: string, onIds: (ids: number[]) => void) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setDropOn(key); } },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropOn((d) => (d === key ? null : d)); },
    onDrop: (e: DragEvent) => { e.preventDefault(); setDropOn(null); try { const ids = JSON.parse(e.dataTransfer.getData(DRAG)) as number[]; if (ids.length) onIds(ids); } catch { /* not ours */ } },
  });

  const filters: Filter[] = ["all", "open", "tray", "saved"];
  const groups = canvas.groups.groups;
  const counts = useMemo(() => {
    const open = windows.filter((w) => !w.closed);
    return { all: open.length + canvas.groups.closed.length, open: open.filter((w) => !w.minimized).length, tray: open.filter((w) => w.minimized).length, saved: canvas.groups.closed.length };
  }, [windows, canvas.groups.closed]);

  const card = (w: WindowData, g: Group) => {
    const sel = selected.includes(w.id);
    const pinned = g.pinnedIds.includes(w.id);
    return (
      <div
        key={w.id}
        role="option"
        aria-selected={sel}
        tabIndex={0}
        className="v2-wcard"
        draggable
        onDragStart={onDragStart(w.id)}
        onClick={() => toggleSelect(w.id)}
        onDoubleClick={() => { canvas.openGroup(g.id); canvas.focusWindow(w.id); onClose(); }}
        onKeyDown={(e) => {
          if (e.key === " ") { e.preventDefault(); toggleSelect(w.id); }
          if (e.key === "Enter") { canvas.openGroup(g.id); canvas.focusWindow(w.id); onClose(); }
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ id: w.id, x: r.left + 20, y: r.top + 20 }); }
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ id: w.id, x: e.clientX, y: e.clientY }); }}
      >
        <span className="v2-wcard-check" aria-hidden="true">{sel && <Check size={13} />}</span>
        <Miniature type={w.type} seed={w.id} />
        <div className="v2-wcard-foot">
          <WindowTypeIcon type={w.type} size={16} />
          <span className="min-w-0 flex-1">
            <strong>{w.title}</strong>
            <small>
              {pinned && <Pin size={11} aria-label={t("v2.space.pinned") as string} />}
              {w.minimized ? t("v2.tray.waiting") : t("v2.tray.on_screen")} · {formatAgo(Date.now() - (canvas.lastUsed(w.id) || Date.now()))}
            </small>
          </span>
        </div>
      </div>
    );
  };

  const savedCard = (c: ClosedEntry) => (
    <div key={`${c.windowId}-${c.closedAt}`} className="v2-wcard" style={{ cursor: "default" }}>
      <Miniature type={c.type} seed={c.windowId} style={{ opacity: 0.6 }} />
      <div className="v2-wcard-foot">
        <WindowTypeIcon type={c.type as WindowType} size={16} />
        <span className="min-w-0 flex-1">
          <strong>{c.title}</strong>
          <small>{c.groupTitle || "—"} · {formatAgo(Date.now() - c.closedAt)}</small>
        </span>
        <button type="button" className="v2-icon-btn sm" onClick={() => canvas.reopen(c)} aria-label={t("v2.tray.reopen_title", { title: c.title }) as string} title={t("v2.tray.reopen") as string}>
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );

  const menuWin = menu ? byId(menu.id) : undefined;
  const menuGroup = menu ? groupOfId(menu.id) : undefined;

  return (
    <div ref={rootRef} className="v2-space v2-enter" role="dialog" aria-modal="true" aria-label={t("v2.menu.space") as string}>
      <div className="v2-space-head">
        <h1>{t("v2.menu.space")}</h1>
        <div className="flex gap-2" role="group" aria-label={t("v2.space.filter") as string}>
          {filters.map((f) => (
            <button key={f} type="button" className="v2-filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`v2.space.f_${f}`)} · {counts[f]}
            </button>
          ))}
        </div>
        <label className="v2-search" style={{ height: 36, flex: "0 1 320px" }}>
          <Search size={16} aria-hidden="true" style={{ color: "var(--muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v2.overview.search") as string} aria-label={t("v2.overview.search") as string} />
        </label>
        <span className="flex-1" />
        <button type="button" className="v2-btn" onClick={onClose}>{t("v2.space.done")}<span className="v2-kbd">Esc</span></button>
      </div>
      <p className="v2-space-hint">{t("v2.space.hint")}</p>
      <div className="v2-columns" role="listbox" aria-multiselectable="true" aria-label={t("v2.space.columns") as string}>
        {filter !== "saved" && groups.map((g) => {
          const ws = g.windowIds.map(byId).filter(visible);
          const active = g.id === canvas.groups.activeGroupId;
          return (
            <section key={g.id} className={`v2-col ${dropOn === g.id ? "is-drop" : ""}`} aria-label={g.title} {...dropProps(g.id, (ids) => move(ids, g.id))}>
              <div className="v2-col-head">
                <span className="v2-swatch" style={{ width: 10, height: 10, borderRadius: 3, background: groupVar(g), flexShrink: 0 }} aria-hidden="true" />
                {renaming === g.id ? (
                  <input
                    autoFocus
                    defaultValue={g.title}
                    aria-label={t("v2.space.rename") as string}
                    onBlur={(e) => { canvas.rename(g.id, e.currentTarget.value.trim() || g.title); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                  />
                ) : (
                  <h3 onDoubleClick={() => setRenaming(g.id)} title={t("v2.space.rename_hint") as string}>{g.title}</h3>
                )}
                <span className="v2-kbd">{ws.length}</span>
                <span className="flex-1" />
                {active && <span className="v2-chip">{t("v2.tray.on_screen")}</span>}
                <button type="button" className="v2-icon-btn sm" onClick={() => { canvas.openGroup(g.id); onClose(); }} title={t("v2.tray.open_group") as string} aria-label={t("v2.tray.open_group") as string}><ArrowUpRight size={16} aria-hidden="true" /></button>
              </div>
              <div className="v2-col-list">
                {ws.length === 0 && <p className="v2-space-hint">{t("v2.space.empty_col")}</p>}
                {ws.map((w) => card(w, g))}
              </div>
            </section>
          );
        })}
        {(filter === "all" || filter === "saved") && (
          <section className="v2-col" aria-label={t("v2.space.f_saved") as string}>
            <div className="v2-col-head"><Archive size={16} aria-hidden="true" style={{ color: "var(--muted)" }} /><h3>{t("v2.space.f_saved")}</h3><span className="v2-kbd">{saved.length}</span></div>
            <div className="v2-col-list">
              {saved.length === 0 && <p className="v2-space-hint">{t("v2.space.no_saved")}</p>}
              {saved.map(savedCard)}
            </div>
          </section>
        )}
        {filter !== "saved" && (
          <section className={`v2-col is-new ${dropOn === "new" ? "is-drop" : ""}`} {...dropProps("new", (ids) => move(ids, "new"))}>
            <FolderPlus size={22} aria-hidden="true" />
            <p className="v2-space-hint" style={{ textAlign: "center" }}>{t("v2.space.new_drop")}</p>
            {selected.length > 0 && <button type="button" className="v2-btn" onClick={() => move(selected, "new")}>{t("v2.space.new_with", { count: selected.length })}</button>}
          </section>
        )}
      </div>

      {selected.length > 0 && !undo && (
        <div className="v2-bulk" role="toolbar" aria-label={t("v2.space.bulk") as string}>
          <span className="v2-t13" style={{ paddingLeft: 6 }}>{t("v2.space.selected", { count: selected.length })}</span>
          <select className="v2-btn" aria-label={t("v2.space.move_to") as string} value="" onChange={(e) => { if (e.target.value) move(selected, e.target.value); }}>
            <option value="">{t("v2.space.move_to")}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            <option value="new">{t("v2.space.new_group")}</option>
          </select>
          <button type="button" className="v2-btn" onClick={() => putAway(selected, "save")}><Archive size={14} aria-hidden="true" />{t("v2.tray.save")}</button>
          <button type="button" className="v2-btn is-danger" onClick={() => putAway(selected, "close")}>{t("common.close")}</button>
          <button type="button" className="v2-icon-btn" onClick={() => setSelected([])} aria-label={t("v2.space.deselect") as string}><X size={16} /></button>
        </div>
      )}
      {undo && (
        <div className="v2-undo" role="status">
          <span className="v2-t13">{undo.label}</span>
          <button type="button" className="v2-btn" onClick={() => { undo.run(); setUndo(null); }}>{t("dock.undo")}</button>
        </div>
      )}
      {menu && menuWin && menuGroup && (
        <div ref={menuRef} className="v2-pop" style={{ position: "fixed", left: menu.x, top: menu.y }} role="menu">
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { canvas.openGroup(menuGroup.id); canvas.focusWindow(menuWin.id); setMenu(null); onClose(); }}>{t("v2.tray.open")}</button>
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { canvas.togglePin(menuWin.id); setMenu(null); }}>{menuGroup.pinnedIds.includes(menuWin.id) ? t("v2.space.unpin") : t("v2.space.pin")}</button>
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { move([menuWin.id], "new"); setMenu(null); }}>{t("v2.space.new_group")}</button>
          <div className="v2-menu-sep" />
          <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { putAway([menuWin.id], "save"); setMenu(null); }}>{t("v2.tray.save")}</button>
          <button type="button" role="menuitem" className="v2-menu-item is-danger" onClick={() => { putAway([menuWin.id], "close"); setMenu(null); }}>{t("common.close")}</button>
        </div>
      )}
    </div>
  );
}
