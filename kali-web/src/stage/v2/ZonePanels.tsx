/**
 * stage/v2/ZonePanels.tsx — Panels that take the artifact zone: the tray and the overview.
 *
 *  - Tray (windows pill): the windows of every group that are not on screen, by group, with the
 *    offer to put away the ones nobody used for an hour, and "Recently closed".
 *  - Overview (layout menu): search across groups, each group as a card with miniatures, and the
 *    closed artifacts (the full library opens from here).
 *
 * Both are real buttons and lists; Esc closes them (handled by the canvas keyboard hook).
 */

import { useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Library, RotateCcw, Search, X } from "lucide-react";
import type { WindowData, WindowType } from "../../workspace/types";
import type { Rect } from "../../workspace/layout";
import type { ClosedEntry, Group } from "../../workspace/groups";
import { WindowTypeIcon } from "../windowIcons";
import type { CanvasStateApi } from "./useCanvasState";
import { groupVar } from "./GroupChrome";
import { formatAgo } from "./useRelativeTime";

const boxStyle = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

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

// ── Shared bits ─────────────────────────────────────────

function Recents({ closed, onReopen, max = 6 }: { closed: ClosedEntry[]; onReopen: (e: ClosedEntry) => void; max?: number }) {
  const { t } = useTranslation();
  if (!closed.length) return null;
  return (
    <section>
      <div className="v2-section-title" style={{ marginBottom: 8 }}>{t("v2.tray.recent")}</div>
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

const winsOf = (g: Group, windows: WindowData[]) => g.windowIds.map((id) => windows.find((w) => w.id === id)).filter((w): w is WindowData => !!w && !w.closed);

// ── Tray ────────────────────────────────────────────────

export function Tray({ canvas, windows, rect, onClose, onLibrary }: { canvas: CanvasStateApi; windows: WindowData[]; rect: Rect; onClose: () => void; onLibrary: () => void }) {
  const { t } = useTranslation();
  const [offerDismissed, setOfferDismissed] = useState(false);
  const activeId = canvas.groups.activeGroupId;
  const groups = canvas.groups.groups;
  const total = windows.filter((w) => !w.closed).length;
  const stale = canvas.staleIds;

  return (
    <section className="v2-zone-panel v2-enter" style={boxStyle(rect)} aria-label={t("v2.tray.title") as string}>
      <div className="v2-zone-head">
        <h2>{t("v2.tray.title")}</h2>
        <span className="v2-chip">{t("v2.hud.windows", { count: total })}</span>
        <span className="flex-1" />
        <button type="button" className="v2-btn" onClick={() => { onClose(); onLibrary(); }}><Library size={14} aria-hidden="true" />{t("v2.menu.library")}</button>
        <button type="button" className="v2-icon-btn" onClick={onClose} aria-label={t("common.close") as string}><X size={16} /></button>
      </div>
      {stale.length > 0 && !offerDismissed && (
        <div className="v2-offer" role="status">
          <p>{t("v2.tray.offer", { count: stale.length })}</p>
          <button type="button" className="v2-btn is-primary" onClick={() => canvas.saveWindows(stale)}><Archive size={14} aria-hidden="true" />{t("v2.tray.offer_save")}</button>
          <button type="button" className="v2-btn is-quiet" onClick={() => setOfferDismissed(true)}>{t("v2.tray.offer_later")}</button>
        </div>
      )}
      <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
        {groups.length === 0 && <p className="v2-space-hint">{t("v2.tray.empty")}</p>}
        {groups.map((g) => {
          const ws = winsOf(g, windows);
          if (!ws.length) return null;
          const isActive = g.id === activeId;
          return (
            <section key={g.id} aria-label={g.title}>
              <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                <span className="v2-group-chip" style={{ ["--gc" as string]: groupVar(g) }}><span className="v2-swatch" aria-hidden="true" /><span className="truncate">{g.title}</span></span>
                {isActive && <span className="v2-chip">{t("v2.tray.on_screen")}</span>}
                <span className="flex-1" />
                {!isActive && <button type="button" className="v2-btn" onClick={() => canvas.openGroup(g.id)}>{t("v2.tray.open_group")}</button>}
                <button type="button" className="v2-btn is-quiet" onClick={() => canvas.saveGroup(g.id)}><Archive size={14} aria-hidden="true" />{t("v2.tray.save_group")}</button>
              </div>
              <div className="v2-cards">
                {ws.map((w) => {
                  const shown = isActive && !w.minimized;
                  return (
                    <article key={w.id} className={`v2-card ${shown ? "is-active" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="v2-tile"><WindowTypeIcon type={w.type} size={16} /></span>
                        <span className="min-w-0">
                          <h3>{w.title}</h3>
                          <div className="v2-card-meta">{t(`v2.type.${w.type}`, { defaultValue: w.type })} · {shown ? t("v2.tray.on_screen") : t("v2.tray.waiting")} · {t("v2.ago.used", { when: formatAgo(Date.now() - (canvas.lastUsed(w.id) || Date.now())) })}</div>
                        </span>
                      </div>
                      <div className="v2-card-actions">
                        <button type="button" className="v2-btn is-primary" onClick={() => { if (!isActive) canvas.openGroup(g.id); canvas.focusWindow(w.id); }}>{t("v2.tray.open")}</button>
                        <button type="button" className="v2-btn is-quiet" onClick={() => canvas.togglePin(w.id)} aria-pressed={g.pinnedIds.includes(w.id)}>{g.pinnedIds.includes(w.id) ? t("v2.space.unpin") : t("v2.space.pin")}</button>
                        <button type="button" className="v2-btn is-quiet" onClick={() => canvas.close(w.id)}>{t("common.close")}</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
        <Recents closed={canvas.groups.closed} onReopen={canvas.reopen} />
      </div>
    </section>
  );
}

// ── Overview ────────────────────────────────────────────

export function Overview({ canvas, windows, rect, onClose, onLibrary }: { canvas: CanvasStateApi; windows: WindowData[]; rect: Rect; onClose: () => void; onLibrary: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => canvas.groups.groups
    .map((g) => ({ g, ws: winsOf(g, windows).filter((w) => !needle || w.title.toLowerCase().includes(needle) || g.title.toLowerCase().includes(needle)) }))
    .filter(({ ws }) => ws.length > 0), [canvas.groups.groups, windows, needle]);
  const closed = canvas.groups.closed.filter((c) => !needle || c.title.toLowerCase().includes(needle));

  return (
    <section className="v2-zone-panel v2-enter" style={boxStyle(rect)} aria-label={t("v2.menu.overview") as string}>
      <div className="v2-zone-head">
        <h2>{t("v2.menu.overview")}</h2>
        <span className="flex-1" />
        <button type="button" className="v2-btn" onClick={onLibrary}><Library size={14} aria-hidden="true" />{t("v2.overview.library")}</button>
        <button type="button" className="v2-icon-btn" onClick={onClose} aria-label={t("common.close") as string}><X size={16} /></button>
      </div>
      <label className="v2-search">
        <Search size={16} aria-hidden="true" style={{ color: "var(--muted)" }} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("v2.overview.search") as string} aria-label={t("v2.overview.search") as string} />
      </label>
      <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
        {groups.length === 0 && <p className="v2-space-hint">{needle ? t("v2.overview.no_match") : t("v2.tray.empty")}</p>}
        <div className="v2-cards">
          {groups.map(({ g, ws }) => {
            const isActive = g.id === canvas.groups.activeGroupId;
            return (
              <article key={g.id} className={`v2-card ${isActive ? "is-active" : ""}`} style={{ ["--gc" as string]: groupVar(g) }}>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, ws.length)}, 1fr)`, gap: 6, marginBottom: 6 }}>
                  {ws.slice(0, 3).map((w) => <Miniature key={w.id} type={w.type} seed={w.id} />)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="v2-swatch" style={{ width: 10, height: 10, borderRadius: 3, background: groupVar(g), flexShrink: 0 }} aria-hidden="true" />
                  <h3>{g.title}</h3>
                </div>
                <div className="v2-card-meta">{t("v2.hud.windows", { count: ws.length })} · {t(`v2.mode.${g.mode}`)} · {t("v2.ago.when", { when: formatAgo(Date.now() - g.lastUsed) })}</div>
                <div className="v2-tiles" style={{ marginTop: 4 }}>
                  {ws.slice(0, 6).map((w) => (
                    <button key={w.id} type="button" className="v2-tile" title={w.title} aria-label={w.title} onClick={() => { canvas.openGroup(g.id); canvas.focusWindow(w.id); }}>
                      <WindowTypeIcon type={w.type} size={16} />
                    </button>
                  ))}
                </div>
                <div className="v2-card-actions">
                  <button type="button" className="v2-btn is-primary" onClick={() => canvas.openGroup(g.id)}>{isActive ? t("v2.overview.back") : t("v2.tray.open_group")}</button>
                  <button type="button" className="v2-btn is-quiet" onClick={() => canvas.openGroup(g.id, "focus")}>{t("v2.mode.focus")}</button>
                  <button type="button" className="v2-btn is-quiet" onClick={() => canvas.openGroup(g.id, "mosaic")}>{t("v2.mode.mosaic")}</button>
                </div>
              </article>
            );
          })}
        </div>
        <Recents closed={closed} onReopen={canvas.reopen} max={12} />
      </div>
    </section>
  );
}
