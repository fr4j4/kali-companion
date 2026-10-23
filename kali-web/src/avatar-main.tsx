// Minimal entrypoint for the native avatar agent (kali-avatar): no router, chat or workspace.
// The agent owns the WebSocket and pushes core events through `window.kaliAvatar.push`.
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "./lib/i18n";
import "./styles.css";
import { AvatarStateTracker, type AvatarViewState, type PresenceEvent } from "./avatar/avatarState";
import { AvatarView } from "./desktop/AvatarView";

interface AvatarHost {
  /** Called by the agent for every presence event (already parsed JSON or a JSON string). */
  push(event: PresenceEvent | string): void;
  /** Called by the agent when its preferences change. */
  configure(options: { showText?: boolean }): void;
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

function NativeAvatar() {
  const tracker = useRef(new AvatarStateTracker());
  const [view, setView] = useState<AvatarViewState>(() => tracker.current.view());
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      const deadline = tracker.current.nextDeadline();
      if (deadline) timer = window.setTimeout(() => { setView(tracker.current.view()); schedule(); }, Math.max(deadline - Date.now(), 0) + 20);
    };
    window.kaliAvatar = {
      push(raw) {
        try {
          const ev = typeof raw === "string" ? (JSON.parse(raw) as PresenceEvent) : raw;
          setView(tracker.current.apply(ev));
          schedule();
        } catch { /* ignore malformed frames */ }
      },
      cursor(x, y) { document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y })); },
      configure(options) { if (options.showText !== undefined) setShowText(options.showText); },
    };
    postToAgent({ type: "ready" });
    return () => { window.clearTimeout(timer); delete window.kaliAvatar; };
  }, []);

  return <AvatarView presence={view} showText={showText} onOpen={() => postToAgent({ type: "open", target: "chat" })} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><NativeAvatar /></React.StrictMode>);
