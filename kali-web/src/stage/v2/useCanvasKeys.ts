/**
 * stage/v2/useCanvasKeys.ts — Keyboard shortcuts of the neural canvas.
 *
 *   Ctrl+K           command palette
 *   Ctrl+1…4         one to four panes (Studio)
 *   Ctrl+Tab         next tab of the pane (Ctrl+Shift+Tab, the previous one)
 *   Ctrl+\           the tab to a new pane on the right
 *   Ctrl+W           close the tab
 *   Alt+1…9          window 1…9 of the group
 *   Ctrl+Shift+E     the board
 *   Ctrl+Shift+F     maximize the pane (Studio); Explorar (Hub)
 *   Ctrl+Shift+T     Hub ⇄ Estudio
 *   Esc              back one level: palette, board, a maximized pane; in the
 *                    Hub Explorar → Lámina → Escucha, and Hilo back where it came from
 *
 * Shortcuts with Ctrl/Alt work everywhere; Esc only acts when the key is not for a text field, a
 * game or an open dialog.
 */

import { useEffect, useRef } from "react";
import type { WindowData } from "../../workspace/types";

export interface CanvasKeyActions {
  palette: () => void;
  /** Ctrl+1…4: one to four panes. */
  preset: (n: 1 | 2 | 3 | 4) => void;
  cycleTab?: (dir: 1 | -1) => void;
  splitRight?: () => void;
  closeTab?: () => void;
  windowAt: (index: number) => void;
  board: () => void;
  /** Maximize the pane, or Explorar. */
  zoom: () => void;
  /** Hub ⇄ Estudio. */
  toggleMode?: () => void;
  /** Returns true when it handled Escape. */
  back: () => boolean;
}

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
      if (ctrl && e.shiftKey && code === "KeyE") { e.preventDefault(); a.board(); return; }
      if (ctrl && e.shiftKey && code === "KeyF") { e.preventDefault(); a.zoom(); return; }
      if (ctrl && e.shiftKey && code === "KeyT" && a.toggleMode) { e.preventDefault(); a.toggleMode(); return; }
      if (ctrl && !e.shiftKey && !e.altKey && /^Digit[1-4]$/.test(code)) {
        e.preventDefault();
        a.preset(Number(code.slice(5)) as 1 | 2 | 3 | 4);
        return;
      }
      if (ctrl && !e.altKey && code === "Tab" && a.cycleTab) { e.preventDefault(); a.cycleTab(e.shiftKey ? -1 : 1); return; }
      if (ctrl && !e.shiftKey && !e.altKey && code === "Backslash" && a.splitRight) { e.preventDefault(); a.splitRight(); return; }
      if (ctrl && !e.shiftKey && !e.altKey && code === "KeyW" && a.closeTab && !isTextTarget(e.target)) { e.preventDefault(); a.closeTab(); return; }
      if (e.altKey && !ctrl && !e.shiftKey && /^Digit[1-9]$/.test(code)) { e.preventDefault(); a.windowAt(Number(code.slice(5)) - 1); return; }
      if (e.key === "Escape" && !e.defaultPrevented) {
        // A text field keeps Esc for itself, except that an open overlay (the board, the
        // palette) closes from anywhere: the composer below it, or its own empty
        // search field.
        if (isTextTarget(e.target)) {
          const overlay = document.querySelector(".v2-board, .v2-palette");
          const field = e.target as HTMLInputElement;
          if (!overlay || (overlay.contains(field) && field.value)) return;
        }
        if (winRef.current.some((w) => w.type === "game" && w.focused && !w.minimized && !w.closed)) return;
        if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.v2-board):not(.v2-palette)')) return;
        if (a.back()) e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
