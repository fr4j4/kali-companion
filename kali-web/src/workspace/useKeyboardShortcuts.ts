/**
 * workspace/useKeyboardShortcuts.ts — Global keyboard shortcuts for the workspace.
 *
 * Shortcuts (all require not being focused in an input/textarea/select):
 *   Ctrl+Z        Undo
 *   Ctrl+Shift+Z  Redo
 *   Ctrl+A        Select all windows
 *   Ctrl+D        Duplicate focused window
 *   Ctrl+F        Open spotlight (handled by parent)
 *   Ctrl+S        Save workspace
 *   Ctrl+B        Toggle drawer
 *   Ctrl+G        Toggle grid/canvas
 *   Ctrl+L        Focus last window
 *   Ctrl+O        Orbit arrange
 *   Delete        Close focused window
 *   Tab           Cycle focus between windows
 *   Arrow keys    Nudge focused window 1px (Shift = 20px)
 *   Ctrl+[1-9]    Focus Nth window
 *   ?             Show keyboard help
 *   Escape        Deselect / close modals
 */

import { useEffect } from "react";
import type { WorkspaceAPI } from "./types";

export function useKeyboardShortcuts(api: WorkspaceAPI, opts: {
  onSpotlight?: () => void;
  onToggleDrawer?: () => void;
  onKbdHelp?: () => void;
  onEscape?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const active = document.activeElement;
      const inInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || (active as HTMLElement).isContentEditable);

      // Escape — universal
      if (e.key === "Escape") {
        api.clearSelection();
        opts.onEscape?.();
        return;
      }

      if (inInput) return;

      // Ctrl+Z / Ctrl+Shift+Z — undo/redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        api.redo();
        return;
      }

      // Ctrl+A — select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        const ids = api.windows.filter((w) => !w.closed).map((w) => w.id);
        api.clearSelection();
        ids.forEach((id) => api.toggleSelect(id));
        return;
      }

      // Ctrl+S — save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        api.saveWorkspace();
        return;
      }

      // Ctrl+B — toggle drawer
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        opts.onToggleDrawer?.();
        return;
      }

      // Ctrl+G — toggle grid
      if ((e.ctrlKey || e.metaKey) && e.key === "g") {
        e.preventDefault();
        api.toggleGrid();
        return;
      }

      // Ctrl+L — focus last
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        api.focusLast();
        return;
      }

      // Ctrl+O — orbit
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        api.arrangeOrbit();
        return;
      }

      // Delete — close focused window
      if (e.key === "Delete") {
        e.preventDefault();
        // The focused window is tracked by the parent; we emit a custom event
        window.dispatchEvent(new CustomEvent("kali:delete-focused"));
        return;
      }

      // ? — help
      if (e.key === "?") {
        e.preventDefault();
        opts.onKbdHelp?.();
        return;
      }

      // Ctrl+F — spotlight
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        opts.onSpotlight?.();
        return;
      }

      // Ctrl+[1-9] — focus nth window
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const visible = api.windows.filter((w) => !w.closed);
        const idx = parseInt(e.key) - 1;
        if (idx < visible.length) api.focusWindow(visible[idx].id);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api, opts]);
}