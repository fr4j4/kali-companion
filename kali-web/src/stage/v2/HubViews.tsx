/**
 * stage/v2/HubViews.tsx — The Hub's pieces that are not Kali's panel or the cards.
 *
 *   ThreadView    Hilo: the conversation as a reading column, 680 units wide, with the avatar
 *                 in its header, the current lámina as a small card and the dock at the bottom.
 *   ExploreExit   Explorar: the one way out besides Esc, top right over the artifact.
 *
 * As in KaliPanel, the avatar is not a child: CanvasV2 places the one AvatarSVG on the header's
 * slot (layout.mapCenter).
 */

import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minimize2, X } from "lucide-react";
import { THREAD_AVATAR, type Rect } from "../../workspace/layout";
import type { WindowData } from "../../workspace/types";
import { ConversationLog } from "../ConversationLog";
import { useKaliStatus } from "./Hud";
import { Miniature } from "./Board";

export function ThreadView({ rect, k, current, onOpen, onClose, consent, dock }: {
  rect: Rect;
  k: number;
  /** The artifact on the lámina, offered back as a card. */
  current: WindowData | null;
  onOpen: () => void;
  onClose: () => void;
  consent?: ReactNode;
  dock: ReactNode;
}) {
  const { t } = useTranslation();
  const { kind, word, model } = useKaliStatus();
  const line = [word, model !== "—" ? model : null].filter(Boolean).join(" · ");
  const style: CSSProperties = { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
  return (
    <section className="v2-thread v2-enter" style={style} aria-label={t("v2.hub.thread") as string}>
      <header className="v2-thread-head">
        <span className="v2-kpanel-slot" style={{ width: THREAD_AVATAR * k, height: THREAD_AVATAR * k }} aria-hidden="true" />
        <div className="v2-kpanel-who">
          <b>{t("assistant.name")}</b>
          <small className={`is-${kind}`} title={line}>{line}</small>
        </div>
        <button type="button" className="v2-icon-btn" onClick={onClose} aria-label={t("v2.hub.thread_close") as string} title={`${t("v2.hub.thread_close")} · Esc`}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="v2-thread-body"><ConversationLog /></div>
      {current && (
        <div className="v2-thread-card">
          <Miniature type={current.type} seed={current.id} style={{ width: 64 * k, height: 40 * k, flexShrink: 0 }} />
          <span className="min-w-0 flex flex-col">
            <span className="v2-ficha-title">{current.title}</span>
            <small>{t(`v2.type.${current.type}`, { defaultValue: current.type })}</small>
          </span>
          <button type="button" className="v2-btn-quiet" onClick={onOpen}>{t("v2.hub.open")}</button>
        </div>
      )}
      {consent}
      <div className="v2-kpanel-dock">{dock}</div>
    </section>
  );
}

export function ExploreExit({ onExit, style }: { onExit: () => void; style?: CSSProperties }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="v2-explore-exit" style={style} onClick={onExit} title={`${t("v2.hub.explore_exit")} · Esc`}>
      <Minimize2 size={14} aria-hidden="true" />
      <span>{t("v2.hub.explore_exit")}</span>
    </button>
  );
}
