/**
 * stage/v2/OrbList.tsx — Kali's capabilities as a list, for her panel.
 *
 * The map's orbs, read top to bottom: one 30 px row per capability that is doing something (a
 * dot of its state's colour, its name, the verb and why), and everything at rest folded into one
 * muted row ("Notas, Agenda, Código · en reposo"). A row is a button: it picks the node, as a
 * click on the map does. Replaces NowList and the chips.
 */

import { useTranslation } from "react-i18next";
import type { NodeId, NodeStatus } from "./mapModel";
import { motiveText, stateWord } from "./NeuralMapV2";

export interface OrbRows {
  active: NodeStatus[];
  resting: NodeId[];
}

/** Busy nodes first (asking, failing, working, recalling, then done), the newest first within each. */
export function orbRows(nodes: NodeId[], statuses: Record<string, NodeStatus>): OrbRows {
  const rank: Record<string, number> = { permission: 0, failed: 1, working: 2, recalling: 3, done: 4 };
  const active = Object.values(statuses)
    .filter((s) => s.state !== "idle")
    .sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || b.since - a.since);
  const busy = new Set(active.map((s) => s.id));
  return { active, resting: nodes.filter((id) => !busy.has(id)) };
}

export function OrbList({ nodes, statuses, onPick, max = 5 }: {
  nodes: NodeId[];
  statuses: Record<string, NodeStatus>;
  onPick: (status: NodeStatus) => void;
  /** Busy rows shown before the rest fold into the resting row. */
  max?: number;
}) {
  const { t } = useTranslation();
  const { active, resting } = orbRows(nodes, statuses);
  const shown = active.slice(0, max);
  const folded = [...active.slice(max).map((s) => s.id), ...resting];
  return (
    <section className="v2-orbs" aria-label={t("v2.panel.orbs") as string}>
      <h3 className="v2-label">{t("v2.panel.orbs")}</h3>
      <ul>
        {shown.map((s) => {
          const motive = motiveText(t as never, s);
          return (
            <li key={s.id}>
              <button type="button" className={`v2-orb-row is-${s.state}`} onClick={() => onPick(s)}>
                <span className="v2-orb-dot" aria-hidden="true" />
                <span className="v2-orb-name">{t(`v2.node.${s.id}`)}</span>
                <small title={motive || undefined}>{[stateWord(t as never, s), motive].filter(Boolean).join(" · ")}</small>
              </button>
            </li>
          );
        })}
        {folded.length > 0 && (
          <li className="v2-orb-row is-resting">
            <span className="v2-orb-dot" aria-hidden="true" />
            <span className="v2-orb-name">{folded.map((id) => t(`v2.node.${id}`)).join(", ")}</span>
            <small>{t("v2.panel.resting")}</small>
          </li>
        )}
      </ul>
    </section>
  );
}
