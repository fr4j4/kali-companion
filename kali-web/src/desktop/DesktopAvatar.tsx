import { useEffect, useState } from "react";
import { loadAvatarConfig, type AvatarConfig } from "../avatar/avatarConfig";
import { subscribeAvatarConfig } from "../avatar/avatarSync";
import { applyMotionPref } from "../avatar/avatarPrefs";
import { AvatarView, type AvatarPresence } from "./AvatarView";
import { useCaptureFeedback } from "./CaptureThumb";

const INITIAL: AvatarPresence = { frame: null, offset: 0, connected: false, text: "" };

/** Electron fallback avatar: the main window computes presence and sends it over IPC. */
export function DesktopAvatar() {
  const [presence, setPresence] = useState<AvatarPresence>(INITIAL);
  const [showText, setShowText] = useState(() => localStorage.getItem("kali.desktop.showText") === "true");
  const [config, setConfig] = useState<AvatarConfig>(() => loadAvatarConfig());
  const { thumb, captured } = useCaptureFeedback({ thumbnail: true, sound: true });
  // The floating window has no settings UI: it follows the main window's profile (same origin storage).
  useEffect(() => {
    const saved = localStorage.getItem("kali.performanceProfile");
    document.documentElement.setAttribute("data-perf-profile", saved === "performance" || saved === "quality" ? saved : "balanced");
    return applyMotionPref();
  }, []);
  useEffect(() => window.kaliDesktop?.onPresence((state) => setPresence(state as AvatarPresence)), []);
  // The shell already applied the user's thumbnail and sound settings before sending the event.
  useEffect(() => window.kaliDesktop?.onCapture?.((state) => captured(state.thumb, { sound: state.sound })), [captured]);
  useEffect(() => subscribeAvatarConfig(setConfig), []);
  useEffect(() => { const onStorage = (event: StorageEvent) => { if (event.key === "kali.desktop.showText") setShowText(event.newValue === "true"); }; window.addEventListener("storage", onStorage); return () => window.removeEventListener("storage", onStorage); }, []);
  return <AvatarView presence={presence} config={config} showText={showText} captureThumb={thumb} onOpen={() => void window.kaliDesktop?.openMain()}
    onToggleText={() => { const next = !showText; setShowText(next); localStorage.setItem("kali.desktop.showText", String(next)); }} />;
}
