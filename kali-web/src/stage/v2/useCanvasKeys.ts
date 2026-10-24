/**
 * stage/v2/useCanvasKeys.ts — Keyboard shortcuts of the neural canvas.
 *
 *   Ctrl+K           command palette
 *   Ctrl+1…4         Dividido, Foco, Mosaico, Pantalla completa
 *   Alt+1…9          window 1…9 of the group
 *   Ctrl+Shift+E     Espacio
 *   Ctrl+Shift+F     full screen (the mode and the real window)
 *   Esc              back one level: palette, Espacio, panel, fullscreen, focus/mosaic
 *
 * Shortcuts with Ctrl/Alt work everywhere; Esc only acts when the key is not for a text field, a
 * game or an open dialog.
 */

import { useEffect, useRef } from "react";
import type { ArtifactMode } from "../../workspace/layout";
import type { WindowData } from "../../workspace/types";

export interface CanvasKeyActions {
  palette: () => void;
  mode: (m: ArtifactMode) => void;
  windowAt: (index: number) => void;
  space: () => void;
  fullscreen: () => void;
  /** Returns true when it handled Escape. */
  back: () => boolean;
}

const MODE_KEYS: ArtifactMode[] = ["split", "focus", "mosaic", "fullscreen"];

export function isTextTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function useCanvasKeys(actions: CanvasKeyActions, windows: WindowData[], enabled = true) {
  const ref = useRef(actions);
  ref.current = actions;
  const winRef = useRef(windows);
  winRef.current = windows;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const a = ref.current;
      const ctrl = e.ctrlKey || e.metaKey;
      const code = e.code;
      if (ctrl && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); a.palette(); return; }
      if (ctrl && e.shiftKey && code === "KeyE") { e.preventDefault(); a.space(); return; }
      if (ctrl && e.shiftKey && code === "KeyF") { e.preventDefault(); a.fullscreen(); return; }
      if (ctrl && !e.shiftKey && !e.altKey && /^Digit[1-4]$/.test(code)) { e.preventDefault(); a.mode(MODE_KEYS[Number(code.slice(5)) - 1]); return; }
      if (e.altKey && !ctrl && !e.shiftKey && /^Digit[1-9]$/.test(code)) { e.preventDefault(); a.windowAt(Number(code.slice(5)) - 1); return; }
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (isTextTarget(e.target)) return;
        if (winRef.current.some((w) => w.type === "game" && w.focused && !w.minimized && !w.closed)) return;
        if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.v2-space):not(.v2-palette)')) return;
        if (a.back()) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
