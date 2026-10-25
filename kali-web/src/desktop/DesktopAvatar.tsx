import { useEffect, useState } from "react";
import { AvatarSVG } from "../avatar/AvatarSVG";
import { loadAvatarConfig, type AvatarState, type AvatarEmotion } from "../avatar/avatarConfig";

interface Presence { mood: string; emotion: string; text: string; connected: boolean }
const INITIAL: Presence = { mood: "idle", emotion: "normal", text: "", connected: false };

export function DesktopAvatar() {
  const [presence, setPresence] = useState<Presence>(INITIAL);
  const [showText, setShowText] = useState(() => localStorage.getItem("kali.desktop.showText") === "true");
  useEffect(() => window.kaliDesktop?.onPresence(setPresence), []);
  useEffect(() => { const onStorage = (event: StorageEvent) => { if (event.key === "kali.desktop.showText") setShowText(event.newValue === "true"); }; window.addEventListener("storage", onStorage); return () => window.removeEventListener("storage", onStorage); }, []);
  return <div className="h-screen w-screen flex flex-col items-center justify-center bg-transparent overflow-hidden select-none">
    <div className="w-[85%] aspect-square cursor-pointer" onClick={() => void window.kaliDesktop?.openMain()} title="Abrir Kali">
      <AvatarSVG state={presence.mood as AvatarState} emotion={presence.emotion as AvatarEmotion} config={loadAvatarConfig()} />
    </div>
    <div className="flex items-center gap-2 rounded-full bg-bg/90 px-3 py-1 text-xs text-fg">
      <span className={`h-2 w-2 rounded-full ${presence.connected ? "bg-green-400" : "bg-red-400"}`} />
      {presence.connected ? "Kali" : "Sin conexión"}
      <button onClick={() => { const next = !showText; setShowText(next); localStorage.setItem("kali.desktop.showText", String(next)); }} aria-label="Mostrar u ocultar texto">⋯</button>
    </div>
    {showText && presence.text && <p className="max-w-[95%] max-h-12 overflow-hidden text-ellipsis text-center text-xs text-fg bg-bg/90 rounded-lg px-2 py-1">{presence.text}</p>}
  </div>;
}
