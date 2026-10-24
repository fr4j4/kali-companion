/**
 * stage/v2/GroupChrome.tsx — The chrome of Focus, Mosaic and Fullscreen.
 *
 *  - GroupRail: one square per group (its initial and colour), the active one outlined; Espacio and
 *    back to Dividido at the bottom.
 *  - TabBar: the group chip, a tab per window (status dot, close), and the Disposición switch.
 *    Tabs drag to reorder; in Mosaic a tab dragged onto a panel takes that panel.
 *  - MosaicDividers: drag, arrow keys (2 %), double click to even the split.
 *  - FullscreenChrome: a bar that appears at the top edge and hides 2 s after you leave it, and the
 *    rail at the left edge.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Layers, Minimize2, Plus, X } from "lucide-react";
import type { WindowData } from "../../workspace/types";
import { mosaicLayout, type ArtifactMode, type CanvasLayout, type MosaicPreset, type Rect } from "../../workspace/layout";
import type { Group } from "../../workspace/groups";
import { WindowTypeIcon } from "../windowIcons";
import type { CanvasStateApi } from "./useCanvasState";
import type { ShellStatus } from "./shell";
import { mosaicAssignment } from "./WindowLayer";
import { MODE_ICONS, MODES } from "./Hud";

export const groupVar = (g: Pick<Group, "color">) => `var(--${g.color})`;
const initial = (title: string) => (title.trim()[0] ?? "·").toUpperCase();
const DRAG_TYPE = "application/x-kali-window";

const boxStyle = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

// ── Group rail ──────────────────────────────────────────

export function GroupRail({ canvas, rect, windows, onSpace, style }: {
  canvas: CanvasStateApi;
  rect: Rect | null;
  windows: WindowData[];
  onSpace: () => void;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const open = (g: Group) => g.windowIds.filter((id) => windows.some((w) => w.id === id && !w.closed)).length;
  // Kit: a group is a dot of its task's colour; the initial shows on hover, or always when two
  // groups share a colour and the dot alone would not tell them apart.
  const sharedColors = new Set(canvas.groups.groups.map((g) => g.color).filter((c, i, all) => all.indexOf(c) !== i));
  return (
    <nav className="v2-rail" style={{ ...(rect ? boxStyle(rect) : {}), ...style }} aria-label={t("v2.rail.label") as string}>
      {canvas.groups.groups.map((g) => {
        const active = g.id === canvas.groups.activeGroupId;
        const n = open(g);
        return (
          <button
            key={g.id}
            type="button"
            className={`v2-rail-btn is-group ${active ? "is-active" : ""} ${sharedColors.has(g.color) ? "show-initial" : ""}`}
            style={{ ["--gc" as string]: groupVar(g) }}
            onClick={() => canvas.openGroup(g.id, canvas.mode === "split" ? undefined : canvas.mode)}
            aria-current={active || undefined}
            aria-label={t("v2.rail.group", { title: g.title, count: n }) as string}
            title={g.title}
          >
            <span className="v2-rail-bar" aria-hidden="true" />
            <span className="v2-rail-dot" aria-hidden="true" />
            <span className="v2-rail-initial" aria-hidden="true">{initial(g.title)}</span>
            {n > 1 && <span className="v2-rail-badge" aria-hidden="true">{n}</span>}
          </button>
        );
      })}
      <button type="button" className="v2-rail-btn is-new" onClick={onSpace} aria-label={t("v2.rail.new") as string} title={t("v2.rail.new") as string}>
        <Plus size={16} aria-hidden="true" />
      </button>
      <span className="flex-1" />
      <button type="button" className="v2-icon-btn" onClick={onSpace} aria-label={t("v2.menu.space") as string} title={t("v2.menu.space") as string}>
        <Layers size={16} aria-hidden="true" />
      </button>
      <button type="button" className="v2-icon-btn" onClick={() => canvas.setMode("split")} aria-label={t("v2.mode.split") as string} title={t("v2.mode.split") as string}>
        <Columns2 size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

// ── Layout switch ───────────────────────────────────────

const PRESETS: MosaicPreset[] = ["2c", "2r", "1+2", "2x2"];

function PresetGlyph({ preset }: { preset: MosaicPreset }) {
  const cells: Record<MosaicPreset, Rect[]> = {
    "1": [{ x: 0, y: 0, w: 14, h: 10 }],
    "2c": [{ x: 0, y: 0, w: 6.5, h: 10 }, { x: 7.5, y: 0, w: 6.5, h: 10 }],
    "2r": [{ x: 0, y: 0, w: 14, h: 4.5 }, { x: 0, y: 5.5, w: 14, h: 4.5 }],
    "1+2": [{ x: 0, y: 0, w: 6.5, h: 10 }, { x: 7.5, y: 0, w: 6.5, h: 4.5 }, { x: 7.5, y: 5.5, w: 6.5, h: 4.5 }],
    "2x2": [{ x: 0, y: 0, w: 6.5, h: 4.5 }, { x: 7.5, y: 0, w: 6.5, h: 4.5 }, { x: 0, y: 5.5, w: 6.5, h: 4.5 }, { x: 7.5, y: 5.5, w: 6.5, h: 4.5 }],
  };
  return (
    <svg width="16" height="12" viewBox="-1 -1 16 12" aria-hidden="true">
      {cells[preset].map((c, i) => <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />)}
    </svg>
  );
}

export function LayoutSwitch({ canvas, mode }: { canvas: CanvasStateApi; mode: ArtifactMode }) {
  const { t } = useTranslation();
  const g = canvas.active;
  return (
    <div className="v2-layout-switch" role="group" aria-label={t("v2.tabs.layout") as string}>
      <span>{t("v2.tabs.layout")}</span>
      {MODES.map((m) => {
        const Icon = MODE_ICONS[m];
        return (
          <button key={m} type="button" className={`v2-icon-btn ${mode === m ? "is-active" : ""}`} aria-pressed={mode === m} onClick={() => canvas.setMode(m)} title={t(`v2.mode.${m}`) as string} aria-label={t(`v2.mode.${m}`) as string}>
            <Icon size={16} aria-hidden="true" />
          </button>
        );
      })}
      {mode === "mosaic" && g && (
        <>
          <span className="v2-sep" aria-hidden="true" />
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`v2-icon-btn sm ${g.mosaic.preset === p ? "is-active" : ""}`}
              aria-pressed={g.mosaic.preset === p}
              onClick={() => canvas.setMosaic(g.id, { preset: p })}
              title={t(`v2.preset.${p}`) as string}
              aria-label={t(`v2.preset.${p}`) as string}
            >
              <PresetGlyph preset={p} />
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ── Tab bar ─────────────────────────────────────────────

const DOT: Record<string, string> = { permission: "is-permission", writing: "is-working", updating: "is-working", running: "is-working", done: "is-ready", saved: "is-ready", error: "is-error" };

export function TabBar({ canvas, windows, status, rect, mode, onOverview, style, showSwitch = true }: {
  canvas: CanvasStateApi;
  windows: WindowData[];
  status: Map<number, ShellStatus | null>;
  rect: Rect | null;
  mode: ArtifactMode;
  onOverview: () => void;
  style?: CSSProperties;
  showSwitch?: boolean;
}) {
  const { t } = useTranslation();
  const g = canvas.active;
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  if (!g) return null;
  const tabs = canvas.tabIds.map((id) => windows.find((w) => w.id === id)).filter(Boolean) as WindowData[];
  const activeId = g.activeId != null && canvas.tabIds.includes(g.activeId) ? g.activeId : canvas.tabIds[0];

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (next) { canvas.focusWindow(next.id); document.getElementById(`v2-tab-${next.id}`)?.focus(); }
  };

  return (
    <div className="v2-tabs" style={{ ...(rect ? boxStyle(rect) : {}), ...style }}>
      <button type="button" className="v2-group-chip" style={{ ["--gc" as string]: groupVar(g) }} onClick={onOverview} title={t("v2.menu.overview") as string}>
        <span className="v2-swatch" aria-hidden="true" />
        <span className="truncate">{g.title}</span>
      </button>
      <div className="v2-tablist" role="tablist" aria-label={t("v2.tabs.label", { group: g.title }) as string}>
        {tabs.map((w, i) => {
          const st = status.get(w.id);
          const selected = w.id === activeId;
          return (
            <div
              key={w.id}
              id={`v2-tab-${w.id}`}
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              className={`v2-tab ${dropBefore === w.id ? "is-drop-before" : ""}`}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, String(w.id)); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDropBefore(w.id); } }}
              onDragLeave={() => setDropBefore((d) => (d === w.id ? null : d))}
              onDrop={(e) => { const id = Number(e.dataTransfer.getData(DRAG_TYPE)); setDropBefore(null); if (id && id !== w.id) canvas.reorder(id, i); }}
              onClick={() => canvas.focusWindow(w.id)}
              onKeyDown={(e) => onKey(e, i)}
              onAuxClick={(e) => { if (e.button === 1) canvas.close(w.id); }}
              title={i < 9 ? `${w.title} · Alt ${i + 1}` : w.title}
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
      {showSwitch && <LayoutSwitch canvas={canvas} mode={mode} />}
    </div>
  );
}

// ── Mosaic dividers and drop targets ────────────────────

export function MosaicControls({ canvas, layout }: { canvas: CanvasStateApi; layout: CanvasLayout }) {
  const { t } = useTranslation();
  const g = canvas.active;
  const zone = layout.artifact;
  const [dragging, setDragging] = useState<"a" | "b" | null>(null);
  const [dropPanel, setDropPanel] = useState<number | null>(null);
  const [tabDrag, setTabDrag] = useState(false);

  // Show panel drop targets only while a tab is being dragged.
  useEffect(() => {
    const on = (e: globalThis.DragEvent) => { if (e.dataTransfer?.types.includes(DRAG_TYPE)) setTabDrag(true); };
    const off = () => { setTabDrag(false); setDropPanel(null); };
    window.addEventListener("dragstart", on);
    window.addEventListener("dragend", off);
    window.addEventListener("drop", off);
    return () => { window.removeEventListener("dragstart", on); window.removeEventListener("dragend", off); window.removeEventListener("drop", off); };
  }, []);

  const setRatio = useCallback((key: "a" | "b", v: number) => { if (g) canvas.setMosaic(g.id, { ratios: { ...g.mosaic.ratios, [key]: v } }); }, [canvas, g]);

  if (!g || !zone) return null;
  const { preset, ids } = mosaicAssignment(canvas.tabIds, g.mosaic.panelIds, g.mosaic.preset);
  const m = mosaicLayout(zone, preset, g.mosaic.ratios, layout.k);

  const startDrag = (key: "a" | "b", orientation: "vertical" | "horizontal", min: number, max: number, span: Rect) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(key);
    const move = (ev: PointerEvent) => {
      const v = orientation === "vertical" ? (ev.clientX - span.x) / span.w : (ev.clientY - span.y) / span.h;
      setRatio(key, Math.min(max, Math.max(min, v)));
    };
    const up = () => { setDragging(null); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onDrop = (i: number) => (e: DragEvent) => {
    const id = Number(e.dataTransfer.getData(DRAG_TYPE));
    setDropPanel(null);
    setTabDrag(false);
    if (!id) return;
    const next = [...ids];
    const at = next.indexOf(id);
    if (at >= 0) next[at] = next[i];
    next[i] = id;
    canvas.setMosaic(g.id, { panelIds: next, preset });
    canvas.focusWindow(id);
  };

  // The canvas root is the coordinate origin of the zone rects.
  const origin = () => document.querySelector(".v2-root")?.getBoundingClientRect() ?? { left: 0, top: 0 };

  return (
    <>
      {m.dividers.map((d) => {
        const ratio = g.mosaic.ratios[d.key];
        // The span the ratio is measured on: the whole zone, or the right column for 1+2's row split.
        const local = preset === "1+2" && d.key === "b" ? m.panels[1] && { x: m.panels[1].x, y: zone.y, w: m.panels[1].w, h: zone.h } : zone;
        return (
          <div
            key={d.key}
            className={`v2-divider is-${d.orientation} ${dragging === d.key ? "is-dragging" : ""}`}
            style={{ ...boxStyle(d.orientation === "vertical" ? { ...d.rect, x: d.rect.x - 4, w: d.rect.w + 8 } : { ...d.rect, y: d.rect.y - 4, h: d.rect.h + 8 }) }}
            role="separator"
            aria-orientation={d.orientation}
            aria-valuemin={Math.round(d.min * 100)}
            aria-valuemax={Math.round(d.max * 100)}
            aria-valuenow={Math.round(ratio * 100)}
            aria-label={t("v2.mosaic.divider") as string}
            tabIndex={0}
            onPointerDown={(e) => { const o = origin(); startDrag(d.key, d.orientation, d.min, d.max, { ...local!, x: local!.x + o.left, y: local!.y + o.top })(e); }}
            onDoubleClick={() => setRatio(d.key, 0.5)}
            onKeyDown={(e) => {
              const dec = d.orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
              const inc = d.orientation === "vertical" ? "ArrowRight" : "ArrowDown";
              if (e.key === dec || e.key === inc) { e.preventDefault(); setRatio(d.key, Math.min(d.max, Math.max(d.min, ratio + (e.key === inc ? 0.02 : -0.02)))); }
              if (e.key === "Enter" || e.key === "Home") { e.preventDefault(); setRatio(d.key, 0.5); }
            }}
          />
        );
      })}
      {tabDrag && m.panels.map((p, i) => (
        <div
          key={i}
          className="absolute"
          style={{ ...boxStyle(p), zIndex: 49 }}
          onDragOver={(e) => { e.preventDefault(); setDropPanel(i); }}
          onDragLeave={() => setDropPanel((d) => (d === i ? null : d))}
          onDrop={onDrop(i)}
        >
          {dropPanel === i && <div className="v2-drop-zone" style={{ inset: 0 }} />}
        </div>
      ))}
    </>
  );
}

// ── Fullscreen chrome ───────────────────────────────────

export const FS_HIDE_MS = 2000;

/** Shows on hover of an edge and hides `FS_HIDE_MS` after the pointer leaves (focus inside keeps it). */
function useAutoHide() {
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback(() => { window.clearTimeout(timer.current); setShown(true); }, []);
  const hideSoon = useCallback(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setShown(false), FS_HIDE_MS); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { shown, show, hideSoon };
}

export function FullscreenChrome({ canvas, windows, status, layout, onOverview, onSpace }: {
  canvas: CanvasStateApi;
  windows: WindowData[];
  status: Map<number, ShellStatus | null>;
  layout: CanvasLayout;
  onOverview: () => void;
  onSpace: () => void;
}) {
  const { t } = useTranslation();
  const bar = useAutoHide();
  const rail = useAutoHide();
  const k = layout.k;
  return (
    <>
      <div className="v2-fs-hot" onPointerEnter={bar.show} aria-hidden="true" />
      <div className="v2-fs-edge" onPointerEnter={rail.show} aria-hidden="true" />
      <div
        className="v2-fs-bar"
        data-shown={bar.shown}
        onPointerEnter={bar.show}
        onPointerLeave={bar.hideSoon}
        onFocus={bar.show}
        onBlur={bar.hideSoon}
      >
        <TabBar canvas={canvas} windows={windows} status={status} rect={null} mode="fullscreen" onOverview={onOverview} style={{ position: "static", flex: 1, minWidth: 0, height: "100%" }} />
        <button type="button" className="v2-btn" onClick={() => canvas.setMode("split")} title={t("v2.fs.exit") as string}>
          <Minimize2 size={16} aria-hidden="true" />{t("v2.fs.exit")}<span className="v2-kbd">Esc</span>
        </button>
      </div>
      <div className="v2-fs-rail" data-shown={rail.shown} onPointerEnter={rail.show} onPointerLeave={rail.hideSoon} onFocus={rail.show} onBlur={rail.hideSoon}>
        <GroupRail canvas={canvas} rect={{ x: 0, y: 0, w: Math.round(56 * k), h: layout.artifact?.h ?? 0 }} windows={windows} onSpace={onSpace} style={{ background: "var(--bg-elev)" }} />
      </div>
      {/* Keyboard users reach the bar without hovering. */}
      <button type="button" className="sr-only" onFocus={bar.show} onClick={bar.show}>{t("v2.fs.show_bar")}</button>
    </>
  );
}

