import { useTranslation } from "react-i18next";
import { AvatarSVG } from "../avatar/AvatarSVG";
import type { AvatarConfig } from "../avatar/avatarConfig";
import type { PresenceSnapshot } from "../avatar/presenceStore";
import { CaptureThumb } from "./CaptureThumb";

export interface AvatarPresence extends PresenceSnapshot { text: string }

interface Props {
  presence: AvatarPresence;
  config: AvatarConfig;
  showText: boolean;
  /** Data URL of the last capture, shown briefly as feedback. */
  captureThumb?: string | null;
  onOpen: () => void;
  onToggleText?: () => void;
  /** Petting gesture (native agent): forwarded to the core as a presence signal. */
  onPet?: () => void;
}

/** Presentational avatar shared by the Electron fallback window and the native agent. */
export function AvatarView({ presence, config, showText, captureThumb = null, onOpen, onToggleText, onPet }: Props) {
  const { t } = useTranslation();
  const activity = presence.frame && presence.connected ? presence.frame.activity.id : "offline";
  const visibleText = showText && presence.connected ? presence.text : "";
  return <div className="h-screen w-screen flex flex-col items-center justify-center relative bg-transparent overflow-hidden select-none">
    <div className="kali-avatar-frame w-[85%] aspect-square cursor-pointer" data-activity={activity} data-connected={presence.connected}
      onClick={() => { onPet?.(); onOpen(); }} title={t("desktop.avatar_open") as string}>
      <AvatarSVG presence={presence} config={config} />
    </div>
    <div className="flex items-center gap-2 rounded-full bg-bg/90 px-3 py-1 text-xs text-fg" role="status">
      <span className={`h-2 w-2 rounded-full ${presence.connected ? "bg-ok" : "bg-err"}`} aria-hidden="true" />
      {presence.connected ? t("desktop.avatar_connected") : t("desktop.avatar_offline")}
      {onToggleText && <button onClick={onToggleText} aria-label={t("desktop.avatar_toggle_text") as string}>⋯</button>}
    </div>
    {/* Keyed by text so each new utterance replays the entry transition. */}
    {visibleText && <p key={visibleText} className="kali-avatar-bubble max-w-[95%] text-center text-xs text-fg bg-bg/90 rounded-lg px-2 py-1">{visibleText}</p>}
    <CaptureThumb thumb={captureThumb} />
  </div>;
}
