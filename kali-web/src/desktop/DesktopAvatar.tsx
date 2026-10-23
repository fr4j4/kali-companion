import { useEffect, useState } from "react";
import { loadAvatarConfig, type AvatarConfig } from "../avatar/avatarConfig";
import { subscribeAvatarConfig } from "../avatar/avatarSync";
import { AvatarView, type AvatarPresence } from "./AvatarView";

const INITIAL: AvatarPresence = { mood: "idle", emotion: "normal", text: "", connected: false };

/** Electron fallback avatar: the main window computes presence and sends it over IPC. */
export function DesktopAvatar() {
  const [presence, setPresence] = useState<AvatarPresence>(INITIAL);
  const [showText, setShowText] = useState(() => localStorage.getItem("kali.desktop.showText") === "true");
  const [config, setConfig] = useState<AvatarConfig>(() => loadAvatarConfig());
  useEffect(() => window.kaliDesktop?.onPresence(setPresence), []);
  useEffect(() => subscribeAvatarConfig(setConfig), []);
  useEffect(() => { const onStorage = (event: StorageEvent) => { if (event.key === "kali.desktop.showText") setShowText(event.newValue === "true"); }; window.addEventListener("storage", onStorage); return () => window.removeEventListener("storage", onStorage); }, []);
  return <AvatarView presence={presence} config={config} showText={showText} onOpen={() => void window.kaliDesktop?.openMain()}
    onToggleText={() => { const next = !showText; setShowText(next); localStorage.setItem("kali.desktop.showText", String(next)); }} />;
}
