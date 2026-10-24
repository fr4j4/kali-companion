// Minimal entrypoint for the native avatar agent (kali-avatar): no router, chat or workspace.
// The agent owns the WebSocket and pushes core events through `window.kaliAvatar.push`.
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "./lib/i18n";
import "./styles.css";
import type { PresenceEvent } from "./avatar/avatarState";
import { PresenceStore } from "./avatar/presenceStore";
import { usePresence } from "./avatar/presence";
import { applyMotionPref } from "./avatar/avatarPrefs";
import { DEFAULT_CONFIG, mergeAvatarConfig, type AvatarConfig } from "./avatar/avatarConfig";
import { AvatarView } from "./desktop/AvatarView";
import { useCaptureFeedback } from "./desktop/CaptureThumb";

interface AvatarHost {
  /** Called by the agent for every presence event (already parsed JSON or a JSON string). */
  push(event: PresenceEvent | string): void;
  /** Called by the agent when its preferences change. */
  configure(options: { showText?: boolean; captureThumbnail?: boolean; captureSound?: boolean }): void;
  /** A capture just happened: show the thumbnail (data URL, or null) and play the shutter. */
  captured(thumb: string | null): void;
  /** Global pointer position relative to the avatar window (the WebView never receives real pointer events). */
  cursor(x: number, y: number): void;
}
declare global {
  interface Window {
    kaliAvatar?: AvatarHost;
    webkit?: { messageHandlers?: Record<string, { postMessage(message: unknown): void }> };
  }
}

function postToAgent(message: unknown): void {
  window.webkit?.messageHandlers?.kali?.postMessage(message);
}

const TEXT_TAIL = 160;

function NativeAvatar() {
  const store = useRef(new PresenceStore()).current;
  const snapshot = usePresence(store);
  const [text, setText] = useState("");
  const [showText, setShowText] = useState(false);
  const [config, setConfig] = useState<AvatarConfig>(DEFAULT_CONFIG);
  const [feedback, setFeedback] = useState({ thumbnail: true, sound: true });
  const capture = useCaptureFeedback(feedback);
  const captured = capture.captured;

  useEffect(() => {
    const stopMotion = applyMotionPref();
    window.kaliAvatar = {
      push(raw) {
        try {
          const ev = typeof raw === "string" ? (JSON.parse(raw) as PresenceEvent) : raw;
          if (ev.event === "avatar_config") { if (ev.config) setConfig(mergeAvatarConfig(ev.config)); return; }
          if (ev.event === "turn_start") setText("");
          else if (ev.event === "delta" && typeof ev.text === "string") setText((t) => (t + ev.text).slice(-TEXT_TAIL));
          else if (ev.event === "message" && ev.role === "assistant" && typeof ev.text === "string") setText(ev.text.slice(-TEXT_TAIL));
          store.ingest(ev);
        } catch { /* ignore malformed frames */ }
      },
      cursor(x, y) { document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y })); },
      configure(options) {
        if (options.showText !== undefined) setShowText(options.showText);
        setFeedback((prev) => ({ thumbnail: options.captureThumbnail ?? prev.thumbnail, sound: options.captureSound ?? prev.sound }));
      },
      captured(thumb) { captured(thumb); },
    };
    postToAgent({ type: "ready" });
    return () => { stopMotion(); delete window.kaliAvatar; };
  }, [captured, store]);

  return <AvatarView presence={{ ...snapshot, text }} onPet={() => postToAgent({ type: "signal", signal: { kind: "pet" } })} config={config} showText={showText} captureThumb={capture.thumb} onOpen={() => postToAgent({ type: "open", target: "chat" })} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><NativeAvatar /></React.StrictMode>);
