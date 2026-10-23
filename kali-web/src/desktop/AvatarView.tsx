import { useTranslation } from "react-i18next";
import { AvatarSVG } from "../avatar/AvatarSVG";
import type { AvatarConfig, AvatarEmotion, AvatarState } from "../avatar/avatarConfig";
import { CaptureThumb } from "./CaptureThumb";

export interface AvatarPresence { mood: string; emotion: string; text: string; connected: boolean }

interface Props {
  presence: AvatarPresence;
  config: AvatarConfig;
  showText: boolean;
  /** Data URL of the last capture, shown briefly as feedback. */
  captureThumb?: string | null;
  onOpen: () => void;
  onToggleText?: () => void;
}

/** Presentational avatar shared by the Electron fallback window and the native agent. */
export function AvatarView({ presence, config, showText, captureThumb = null, onOpen, onToggleText }: Props) {
  const { t } = useTranslation();
  const visibleText = showText && presence.connected ? presence.text : "";
  return <div className="h-screen w-screen flex flex-col items-center justify-center relative bg-transparent overflow-hidden select-none">
    <div className="kali-avatar-frame w-[85%] aspect-square cursor-pointer" data-mood={presence.mood} data-connected={presence.connected}
      onClick={onOpen} title={t("desktop.avatar_open") as string}>
      <AvatarSVG state={presence.mood as AvatarState} emotion={presence.emotion as AvatarEmotion} config={config} />
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
