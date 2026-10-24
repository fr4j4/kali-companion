import { useCallback, useEffect, useState } from "react";

const OPEN_KEY = "kali.chatDock";
const WIDTH_KEY = "kali.chatDock.w";
export const CHAT_DOCK_MIN = 300;
export const CHAT_DOCK_MAX = 640;
const DEFAULT_WIDTH = 380;
/** Below this viewport width the canvas needs the full width; the chat opens as a modal instead. */
export const CHAT_DOCK_MIN_VIEWPORT = 1000;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage may be unavailable */ }
}

const clampWidth = (w: number) => Math.min(CHAT_DOCK_MAX, Math.max(CHAT_DOCK_MIN, Math.round(w)));

/**
 * State of the docked chat panel: open/closed (remembered), width (remembered, resizable) and the
 * `--chat-dock-w` CSS variable the stage, HUD, dock and window placement use to leave room for it.
 * It is closed by default (the dock input carries the conversation) and never docks on narrow screens.
 */
export function useChatDock() {
  const [wide, setWide] = useState(() => window.innerWidth >= CHAT_DOCK_MIN_VIEWPORT);
  const [pref, setPref] = useState<boolean>(() => read(OPEN_KEY) === "open");
  const [width, setWidthState] = useState(() => clampWidth(Number(read(WIDTH_KEY)) || DEFAULT_WIDTH));

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= CHAT_DOCK_MIN_VIEWPORT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const docked = wide && pref;

  useEffect(() => {
    document.documentElement.style.setProperty("--chat-dock-w", docked ? `${width}px` : "0px");
    return () => { document.documentElement.style.setProperty("--chat-dock-w", "0px"); };
  }, [docked, width]);

  const setOpen = useCallback((open: boolean) => { setPref(open); write(OPEN_KEY, open ? "open" : "closed"); }, []);
  const toggle = useCallback(() => setPref((p) => { write(OPEN_KEY, p ? "closed" : "open"); return !p; }), []);
  const setWidth = useCallback((w: number, persist = true) => {
    const next = clampWidth(w);
    setWidthState(next);
    if (persist) write(WIDTH_KEY, String(next));
  }, []);

  return { wide, docked, open: pref, setOpen, toggle, width, setWidth };
}
