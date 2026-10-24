/**
 * stage/NeuralMap.tsx — Ring of activity nodes around the avatar.
 *
 * Each node stands for something Kali can be doing (searching, looking at the screen, running code…)
 * and lights up while a matching tool runs. Curves tie the nodes to the avatar. Geometry comes from
 * `neuralMap.ts`, so it follows the stage size; the whole layer is decorative-plus-status and never
 * takes pointer events. Animation is a single CSS dash flow on active links only, off under the
 * performance profile and reduced motion.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Code2, Gamepad2, Globe, Monitor, NotebookText, Search, type LucideIcon } from "lucide-react";
import { useStage } from "./StageProvider";
import { connectionPath, layoutNodes, nodeStates, type NodeId } from "./neuralMap";

const ICONS: Record<NodeId, LucideIcon> = {
  research: Search,
  screen: Monitor,
  code: Code2,
  files: NotebookText,
  desktop: Globe,
  games: Gamepad2,
  voice: AudioLines,
};

interface Props {
  /** Horizontal space on the right the avatar zone leaves free (px). */
  padRight: number;
  /** Radius of the avatar's outer edge (px). */
  coreRadius: number;
  hidden?: boolean;
}

/** Vertical position of the avatar centre as a fraction of the stage height (matches NeuralCanvas). */
export const CORE_Y = 0.44;

export function NeuralMap({ padRight, coreRadius, hidden }: Props) {
  const { t } = useTranslation();
  const { chat, ptt, tts } = useStage();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const center = useMemo(() => ({ x: (size.w - padRight) / 2, y: size.h * CORE_Y }), [size, padRight]);
  const layout = useMemo(
    () => layoutNodes({ w: size.w - padRight, h: size.h }, center, coreRadius),
    [size, padRight, center, coreRadius],
  );
  const states = nodeStates(chat.toolEvents, { listening: ptt.state === "recording", speaking: tts.playing });

  return (
    <div ref={ref} className="neural-map pointer-events-none absolute inset-0" style={{ zIndex: 12, opacity: hidden ? 0 : 1 }} role="list" aria-label={t("map.label") as string}>
      {layout && (
        <>
          <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
            {layout.nodes.map((n) => (
              <path
                key={n.id}
                d={connectionPath(center, coreRadius, n.pos)}
                className={`nm-link ${states[n.id] === "active" ? "is-active" : ""}`}
                style={{ ["--nm-c" as string]: n.tone === "context" ? "var(--accent2)" : "var(--accent)" }}
              />
            ))}
          </svg>
          {layout.nodes.map((n) => {
            const Icon = ICONS[n.id];
            const active = states[n.id] === "active";
            return (
              <div
                key={n.id}
                role="listitem"
                data-neural-node={n.id}
                className={`nm-node ${active ? "is-active" : ""}`}
                style={{ left: n.pos.x, top: n.pos.y, ["--nm-c" as string]: n.tone === "context" ? "var(--accent2)" : "var(--accent)" }}
              >
                <Icon size={16} aria-hidden="true" className="nm-icon" />
                <span className="flex flex-col leading-tight">
                  <span className="nm-name">{t(`map.node.${n.id}`)}</span>
                  <span className="nm-state">{active ? t(`map.active.${n.id}`) : t("map.idle")}</span>
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
