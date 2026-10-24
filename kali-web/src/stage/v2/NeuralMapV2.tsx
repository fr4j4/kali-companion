/**
 * stage/v2/NeuralMapV2.tsx — Kali's map: the real avatar at the centre, what she can use around.
 *
 * Paints the pure geometry of mapModel.ts in the map rectangle the zone model gives: two dotted
 * rings and a halo (one static SVG; only the slow ring turn is a CSS animation), a curve to each
 * node's port, the node cards (stage, compact) or short labels (mini), and data points. Each node
 * is a real button that picks it for the inspector. The avatar is always the live AvatarSVG and
 * keeps one instance across modes; it glides with a FLIP when the map moves.
 */

import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasLayout, Rect } from "../../workspace/layout";
import { flip } from "../../lib/motion";
import { linkPath, placeNodes, rings, starDots, type NodeId, type NodeStatus } from "./mapModel";
import { NODE_ICONS } from "./nodeIcons";
import { toolLabel } from "../../lib/toolLabels";

interface Props {
  layout: CanvasLayout;
  nodes: NodeId[];
  statuses: Record<string, NodeStatus>;
  picked: NodeId | null;
  onPick: (id: NodeId) => void;
  /** The avatar element (AvatarSVG), mounted once. */
  avatar: ReactNode;
  /** Ring colour of the bubble: permission (amber), done (green). */
  bubbleTone?: "permission" | "done" | "working" | null;
  bubbleCount?: number;
  onBubble?: () => void;
  bubbleLabel?: string;
  /** State ring around the avatar: listening (accent2) or working (accent). */
  avatarTone?: "listening" | "working" | null;
}

const STATE_VAR: Record<string, string> = {
  idle: "var(--muted)",
  working: "var(--accent)",
  recalling: "var(--accent2)",
  permission: "var(--accent)",
  failed: "var(--err)",
  done: "var(--ok)",
};

export function stateWord(t: (k: string, o?: Record<string, unknown>) => string, st: NodeStatus | undefined): string {
  if (!st || st.state === "idle") return t("v2.state.idle");
  if ((st.state === "working" || st.state === "recalling") && st.verb) return t(`v2.verb.${st.verb}`);
  return t(`v2.state.${st.state}`);
}

export function motiveText(t: (k: string, o?: Record<string, unknown>) => string, st: NodeStatus | undefined): string {
  if (!st?.motive) return "";
  const params: Record<string, unknown> = { ...(st.motive.params ?? {}) };
  // A motive whose every value is empty would print only its quotes («»): say nothing instead.
  const values = Object.values(params);
  if (values.length && values.every((v) => v === "" || v == null)) return "";
  if (st.motive.key === "generic" && typeof params.tool === "string") params.tool = toolLabel(t, params.tool);
  return t(`v2.motive.${st.motive.key}`, { ...params, defaultValue: "" }).trim();
}

function NeuralMapV2Impl({ layout, nodes, statuses, picked, onPick, avatar, bubbleTone, bubbleCount, onBubble, bubbleLabel, avatarTone }: Props) {
  const { t } = useTranslation();
  const avatarRef = useRef<HTMLDivElement>(null);
  const prevBox = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const { map, mapCenter, mapDensity: density, k, bubble } = layout;
  const size = layout.avatar;

  // Avatar box (absolute, canvas coordinates).
  const box = mapCenter ? { x: mapCenter.x - size / 2, y: mapCenter.y - size / 2, w: size, h: size } : null;
  useLayoutEffect(() => {
    const el = avatarRef.current;
    if (el && box && prevBox.current) flip(el, prevBox.current, box);
    if (box) prevBox.current = box;
  }, [box?.x, box?.y, box?.w]); // eslint-disable-line react-hooks/exhaustive-deps

  const placed = useMemo(() => (map && mapCenter ? placeNodes(nodes, statuses, map, mapCenter, density, k) : []), [nodes, statuses, map, mapCenter, density, k]);
  const ring = useMemo(() => (map ? rings(density, map, k) : null), [density, map, k]);
  const stars = useMemo(() => (ring && mapCenter && density !== "mini" ? starDots(mapCenter, ring, density === "stage" ? 14 : 10) : []), [ring, mapCenter, density]);
  const coreR = size / 2 + 4 * k;

  // SVG works in map-local coordinates.
  const ox = map?.x ?? 0;
  const oy = map?.y ?? 0;
  const L = (x: number) => x - ox;
  const T = (y: number) => y - oy;

  return (
    <>
      {map && mapCenter && ring && (
        <div className={`v2-map is-${density}`} style={{ left: map.x, top: map.y, width: map.w, height: map.h }} role="group" aria-label={t("map.label") as string}>
          <svg className="v2-map-svg" width={map.w} height={map.h} aria-hidden="true">
            <defs>
              <radialGradient id="v2-halo">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
                <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.05" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse className="v2-halo" cx={L(mapCenter.x)} cy={T(mapCenter.y)} rx={ring.r2 * 1.05} ry={ring.r2 * 1.05 * ring.sy} fill="url(#v2-halo)" />
            <g className={density === "mini" ? "v2-rings is-still" : "v2-rings"} style={{ transformOrigin: `${L(mapCenter.x)}px ${T(mapCenter.y)}px` }}>
              <ellipse cx={L(mapCenter.x)} cy={T(mapCenter.y)} rx={ring.r1} ry={ring.r1 * ring.sy} className="v2-ring" />
              <ellipse cx={L(mapCenter.x)} cy={T(mapCenter.y)} rx={ring.r2} ry={ring.r2 * ring.sy} className="v2-ring is-outer" />
            </g>
            {stars.map((s, i) => <circle key={i} cx={L(s.x)} cy={T(s.y)} r={1.6 * k} className="v2-star" />)}
            {placed.map((p) => {
              const st = statuses[p.id]?.state ?? "idle";
              const d = linkPath({ x: L(mapCenter.x), y: T(mapCenter.y) }, coreR, { x: L(p.port.x), y: T(p.port.y) });
              return (
                <g key={p.id} className={`v2-link-g is-${st}`} style={{ ["--c" as string]: STATE_VAR[st] }}>
                  {(st === "working" || st === "recalling") && <path d={d} className="v2-link-halo" />}
                  <path d={d} className="v2-link" />
                  {p.points.map((pt, i) => (
                    <g key={i}>
                      <line x1={L(p.port.x)} y1={T(p.port.y)} x2={L(pt.x)} y2={T(pt.y)} className="v2-point-line" />
                      <circle cx={L(pt.x)} cy={T(pt.y)} r={3 * k} className="v2-point">
                        <title>{(() => { const dp = (statuses[p.id]?.points ?? []).slice(-p.points.length)[i]; return dp?.detail ?? dp?.label ?? ""; })()}</title>
                      </circle>
                    </g>
                  ))}
                  {(st !== "idle") && <circle cx={L(p.port.x)} cy={T(p.port.y)} r={9.5 * k} className="v2-port-ring" />}
                  {st === "permission" && <circle cx={L(p.port.x)} cy={T(p.port.y)} r={9.5 * k} className="v2-port-pulse" />}
                  <circle cx={L(p.port.x)} cy={T(p.port.y)} r={(density === "mini" ? 5 : 6) * k} className="v2-port" />
                </g>
              );
            })}
          </svg>
          {placed.map((p) => {
            const st = statuses[p.id];
            const state = st?.state ?? "idle";
            const Icon = NODE_ICONS[p.id];
            const name = t(`v2.node.${p.id}`);
            const word = stateWord(t as never, st);
            const motive = motiveText(t as never, st);
            const card: Rect = { ...p.card, x: p.card.x - ox, y: p.card.y - oy };
            if (p.resting) {
              return (
                <button
                  key={p.id}
                  type="button"
                  data-node={p.id}
                  className={`v2-node-label is-${state} side-${p.side} ${density !== "mini" ? "is-resting" : ""}`}
                  style={{ left: card.x, top: card.y, width: card.w, ["--c" as string]: STATE_VAR[state] }}
                  onClick={() => onPick(p.id)}
                  aria-label={`${name}, ${word}`}
                  title={`${name} · ${word}`}
                >
                  {name}
                </button>
              );
            }
            return (
              <button
                key={p.id}
                type="button"
                data-node={p.id}
                className={`v2-node is-${state} ${picked === p.id ? "is-picked" : ""} is-${density}`}
                style={{ left: card.x, top: card.y, width: card.w, minHeight: density === "compact" ? card.h : undefined, ["--c" as string]: STATE_VAR[state] }}
                onClick={() => onPick(p.id)}
                aria-label={`${name}, ${word}${motive ? `. ${motive}` : ""}`}
                aria-pressed={picked === p.id}
              >
                <span className="v2-node-name"><Icon size={Math.round(15 * k)} aria-hidden="true" />{name}</span>
                <span className="v2-node-state">{word}</span>
                {density === "stage" && motive && <span className="v2-node-motive">{motive}</span>}
              </button>
            );
          })}
        </div>
      )}
      {box && (
        <div
          ref={avatarRef}
          id="avatar-container"
          className={`v2-avatar ${bubble ? `is-bubble ${bubbleTone ? `tone-${bubbleTone}` : ""}` : `is-${density}`} ${!bubble && avatarTone ? `ring-${avatarTone}` : ""}`}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        >
          {!bubble && <span className="v2-avatar-halo" aria-hidden="true" />}
          {!bubble && avatarTone && <span className="v2-avatar-ring" aria-hidden="true" />}
          {avatar}
          {bubble && (
            <button type="button" className="v2-bubble-hit" onClick={onBubble} aria-label={bubbleLabel}>
              {!!bubbleCount && <span className="v2-bubble-count">{bubbleCount}</span>}
            </button>
          )}
        </div>
      )}
    </>
  );
}

export const NeuralMapV2 = memo(NeuralMapV2Impl);
