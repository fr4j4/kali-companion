/**
 * stage/v2/AreaHead.tsx — The head of the Studio's area: whose task this is and how it is split.
 *
 *   [● Portada de la web del reloj ▾]                     Paneles [▭] [◫] [◫▤] [⊞]  [▦]
 *
 * The group pill (its colour and title) opens a small menu: rename, put the group away, the
 * overview. The four buttons are Ctrl+1…4 (one, two, three or four panes, filled with the tabs
 * in order); the last one is the overview, until the board of phase E replaces it.
 */

import { useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ChevronDown, LayoutGrid, Pencil } from "lucide-react";
import type { Rect } from "../../workspace/layout";
import { leaves } from "../../workspace/panes";
import type { CanvasStateApi } from "./useCanvasState";
import { groupVar } from "./GroupChrome";
import type { StudioView } from "./Pane";

type Preset = 1 | 2 | 3 | 4;
const CELLS: Record<Preset, Rect[]> = {
  1: [{ x: 0, y: 0, w: 14, h: 10 }],
  2: [{ x: 0, y: 0, w: 6.5, h: 10 }, { x: 7.5, y: 0, w: 6.5, h: 10 }],
  3: [{ x: 0, y: 0, w: 6.5, h: 10 }, { x: 7.5, y: 0, w: 6.5, h: 4.5 }, { x: 7.5, y: 5.5, w: 6.5, h: 4.5 }],
  4: [{ x: 0, y: 0, w: 6.5, h: 4.5 }, { x: 7.5, y: 0, w: 6.5, h: 4.5 }, { x: 0, y: 5.5, w: 6.5, h: 4.5 }, { x: 7.5, y: 5.5, w: 6.5, h: 4.5 }],
};

export function PresetGlyph({ n }: { n: Preset }) {
  return (
    <svg width="16" height="12" viewBox="-1 -1 16 12" aria-hidden="true">
      {CELLS[n].map((c, i) => <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />)}
    </svg>
  );
}

export function AreaHead({ canvas, rect, view, onOverview }: {
  canvas: CanvasStateApi;
  rect: Rect;
  view: StudioView;
  onOverview: () => void;
}) {
  const { t } = useTranslation();
  const g = canvas.active;
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!g) return null;
  const panes = view.zoomed ? 1 : Math.min(4, leaves(view.tree).length);
  const style: CSSProperties = { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
  const commit = () => { const v = input.current?.value.trim(); if (v) canvas.rename(g.id, v); setEditing(false); };

  return (
    <div className="v2-area-head" style={style}>
      <div className="relative">
        {editing ? (
          <input
            ref={input}
            className="v2-group-chip is-editing"
            style={{ ["--gc" as string]: groupVar(g) }}
            defaultValue={g.title}
            autoFocus
            aria-label={t("v2.area.rename") as string}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }}
          />
        ) : (
          <button
            type="button"
            className="v2-group-chip"
            style={{ ["--gc" as string]: groupVar(g) }}
            onClick={() => setMenu((v) => !v)}
            onDoubleClick={() => { setMenu(false); setEditing(true); }}
            aria-haspopup="menu"
            aria-expanded={menu}
            title={g.title}
          >
            <span className="v2-swatch" aria-hidden="true" />
            <span className="truncate">{g.title}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
        {menu && (
          <div className="v2-pop" style={{ top: "calc(100% + 6px)", left: 0, minWidth: 220 }} role="menu" onMouseLeave={() => setMenu(false)}>
            <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { setMenu(false); setEditing(true); }}><Pencil size={16} /><span>{t("v2.area.rename")}</span></button>
            <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { setMenu(false); onOverview(); }}><LayoutGrid size={16} /><span>{t("v2.menu.overview")}</span></button>
            <button type="button" role="menuitem" className="v2-menu-item" onClick={() => { setMenu(false); canvas.saveGroup(g.id); }}><Archive size={16} /><span>{t("v2.area.put_away")}</span></button>
          </div>
        )}
      </div>
      <span className="flex-1" />
      <div className="v2-layout-switch" role="group" aria-label={t("v2.area.panes") as string}>
        <span>{t("v2.area.panes")}</span>
        {([1, 2, 3, 4] as Preset[]).map((n) => (
          <button
            key={n}
            type="button"
            className={`v2-icon-btn ${panes === n ? "is-active" : ""}`}
            aria-pressed={panes === n}
            onClick={() => canvas.toPreset(n)}
            title={`${t("v2.area.preset", { count: n })} · Ctrl ${n}`}
            aria-label={t("v2.area.preset", { count: n }) as string}
          >
            <PresetGlyph n={n} />
          </button>
        ))}
        <span className="v2-sep" aria-hidden="true" />
        <button type="button" className="v2-icon-btn" onClick={onOverview} title={t("v2.menu.overview") as string} aria-label={t("v2.menu.overview") as string}>
          <LayoutGrid size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
