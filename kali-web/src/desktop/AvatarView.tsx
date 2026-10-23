import { AvatarSVG } from "../avatar/AvatarSVG";
import { loadAvatarConfig, type AvatarEmotion, type AvatarState } from "../avatar/avatarConfig";

export interface AvatarPresence { mood: string; emotion: string; text: string; connected: boolean }

interface Props {
  presence: AvatarPresence;
  showText: boolean;
  onOpen: () => void;
  onToggleText?: () => void;
}

/** Presentational avatar shared by the Electron fallback window and the native agent. */
export function AvatarView({ presence, showText, onOpen, onToggleText }: Props) {
  return <div className="h-screen w-screen flex flex-col items-center justify-center bg-transparent overflow-hidden select-none">
    <div className="w-[85%] aspect-square cursor-pointer" onClick={onOpen} title="Abrir Kali">
      <AvatarSVG state={presence.mood as AvatarState} emotion={presence.emotion as AvatarEmotion} config={loadAvatarConfig()} />
    </div>
    <div className="flex items-center gap-2 rounded-full bg-bg/90 px-3 py-1 text-xs text-fg">
      <span className={`h-2 w-2 rounded-full ${presence.connected ? "bg-green-400" : "bg-red-400"}`} />
      {presence.connected ? "Kali" : "Sin conexión"}
      {onToggleText && <button onClick={onToggleText} aria-label="Mostrar u ocultar texto">⋯</button>}
    </div>
    {showText && presence.text && <p className="max-w-[95%] max-h-12 overflow-hidden text-ellipsis text-center text-xs text-fg bg-bg/90 rounded-lg px-2 py-1">{presence.text}</p>}
  </div>;
}
