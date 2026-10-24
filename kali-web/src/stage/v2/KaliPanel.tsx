/**
 * stage/v2/KaliPanel.tsx — Kali's panel: the one place she lives beside your artifacts.
 *
 *   ┌──────────────────────────────┐
 *   │ (avatar 72)  Kali            │  header: the avatar's slot, her name, what she is doing,
 *   │              Trabajando · …  │  the model and the task; the Hub · Estudio switch
 *   │              [Hub · Estudio] │
 *   ├──────────────────────────────┤
 *   │ ORBES                        │  OrbList: busy capabilities, the rest folded
 *   │ ● Investigar  Buscando · …   │
 *   ├──────────────────────────────┤
 *   │ conversation / voice         │  scrolls; the dock below never moves
 *   │ (children: the Hub's cards)  │
 *   │ [permission card]            │
 *   │ [ dock ]                     │
 *   └──────────────────────────────┘
 *
 * The same component is the Studio's right panel and the Hub's column in Lámina. The avatar is
 * not a child: CanvasV2 mounts the AvatarSVG once and places it on the slot (layout.mapCenter),
 * so it travels between the map, this slot and the bubble without remounting.
 */

import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PANEL_AVATAR, type Rect } from "../../workspace/layout";
import { useStage } from "../StageProvider";
import { ConversationLog } from "../ConversationLog";
import { useKaliStatus } from "./Hud";
import { OrbList } from "./OrbList";
import { VoiceText, useVoice } from "./KaliZone";
import type { NodeId, NodeStatus } from "./mapModel";
import type { CanvasModeName } from "./useCanvasMode";

interface Props {
  side: "left" | "right";
  rect: Rect;
  /** Scale (px per design unit), for the avatar slot. */
  k: number;
  /** Narrow: no orbs, only the essentials. */
  compact?: boolean;
  /** The current task, said after the model. */
  taskTitle?: string | null;
  nodes: NodeId[];
  statuses: Record<string, NodeStatus>;
  onPickOrb: (status: NodeStatus) => void;
  /** Hub · Estudio switch. */
  mode?: CanvasModeName;
  onSwitchMode?: (mode: CanvasModeName) => void;
  switchEnabled?: boolean;
  /** Controls at the right of the header (the layout menu for now). */
  headerExtra?: ReactNode;
  consent?: ReactNode;
  dock: ReactNode;
  /** Extra content between the orbs and the conversation (the Hub's "Anteriores"). */
  children?: ReactNode;
  /** Show Kali's last answer instead of the whole conversation. */
  voiceOnly?: boolean;
}

export function KaliPanel(p: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { kind, word, model } = useKaliStatus();
  const style: CSSProperties = { left: p.rect.x, top: p.rect.y, width: p.rect.w, height: p.rect.h };
  const line = [word, model !== "—" ? model : null, p.taskTitle].filter(Boolean).join(" · ");
  const hasHistory = chat.messages.some((m) => m.content || m.toolEvent);

  return (
    <aside className={`v2-kpanel side-${p.side} ${p.compact ? "is-compact" : ""}`} style={style} aria-label={t("v2.column.label") as string}>
      <header className="v2-kpanel-head">
        <span className="v2-kpanel-slot" style={{ width: PANEL_AVATAR * p.k, height: PANEL_AVATAR * p.k }} aria-hidden="true" />
        <div className="v2-kpanel-who">
          <b>{t("assistant.name")}</b>
          <small className={`is-${kind}`} title={line}>{line}</small>
          <ModeSeg mode={p.mode ?? "studio"} onSwitch={p.onSwitchMode} enabled={p.switchEnabled} />
        </div>
        {p.headerExtra && <div className="v2-kpanel-extra">{p.headerExtra}</div>}
      </header>
      {!p.compact && <OrbList nodes={p.nodes} statuses={p.statuses} onPick={p.onPickOrb} />}
      {p.children}
      <div className="v2-kpanel-body">
        {p.voiceOnly || !hasHistory ? <PanelVoice /> : <ConversationLog />}
      </div>
      {p.consent}
      <div className="v2-kpanel-dock">{p.dock}</div>
    </aside>
  );
}

/** Hub · Estudio: in Kali's panel, and alone at the top right where there is no panel. */
export function ModeSeg({ mode, onSwitch, enabled = true, style }: { mode: CanvasModeName; onSwitch?: (m: CanvasModeName) => void; enabled?: boolean; style?: CSSProperties }) {
  const { t } = useTranslation();
  return (
    <div className={`v2-seg sm ${style ? "absolute" : ""}`} style={style} role="group" aria-label={t("v2.panel.mode") as string}>
      {(["hub", "studio"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          disabled={!enabled}
          onClick={() => { if (m !== mode) onSwitch?.(m); }}
          title={enabled ? `${t(`v2.panel.mode_${m}`)} · Ctrl ⇧ T` : undefined}
        >
          {t(`v2.panel.mode_${m}`)}
        </button>
      ))}
    </div>
  );
}

function PanelVoice() {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { echo, answer, streaming } = useVoice();
  return (
    <div className="v2-column-voice" aria-live="polite">
      {echo && <div className="v2-echo">“{echo}”</div>}
      {answer
        ? <VoiceText answer={answer} streaming={streaming} />
        : <p className="v2-t13" style={{ color: "var(--muted)", margin: 0 }}>{chat.isThinking ? t("stage.thinking") : t("stage.empty_state")}</p>}
    </div>
  );
}
