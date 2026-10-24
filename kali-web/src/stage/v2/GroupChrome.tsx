/**
 * stage/v2/GroupChrome.tsx — The group rail of the Studio: one dot per group (its colour; the
 * initial on hover), the active one outlined, a new group and the board at the bottom. The tabs and
 * panes live in Pane.tsx, the head of the area in AreaHead.tsx.
 */

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Plus } from "lucide-react";
import type { WindowData } from "../../workspace/types";
import type { Rect } from "../../workspace/layout";
import type { Group } from "../../workspace/groups";
import type { CanvasStateApi } from "./useCanvasState";

export const groupVar = (g: Pick<Group, "color">) => `var(--${g.color})`;
const initial = (title: string) => (title.trim()[0] ?? "·").toUpperCase();

const boxStyle = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

// ── Group rail ──────────────────────────────────────────

export function GroupRail({ canvas, rect, windows, onBoard, style }: {
  canvas: CanvasStateApi;
  rect: Rect | null;
  windows: WindowData[];
  onBoard: () => void;
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
            onClick={() => canvas.openGroup(g.id)}
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
      <button type="button" className="v2-rail-btn is-new" onClick={onBoard} aria-label={t("v2.rail.new") as string} title={t("v2.rail.new") as string}>
        <Plus size={16} aria-hidden="true" />
      </button>
      <span className="flex-1" />
      <button type="button" className="v2-icon-btn" onClick={onBoard} aria-label={t("v2.board.title") as string} title={t("v2.board.title") as string}>
        <LayoutDashboard size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}
