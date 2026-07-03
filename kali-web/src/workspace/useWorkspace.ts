/**
 * workspace/useWorkspace.ts — Orchestration hook for the spatial workspace.
 *
 * Combines all sub-hooks (undo/redo, multi-select, persistence, keyboard)
 * and exposes a unified WorkspaceAPI.  NeuralCanvas consumes this hook to
 * manage the artifact canvas.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import type {
  WindowData,
  WindowType,
  Position,
  Size,
  CreateWindowOpts,
  UndoAction,
} from "./types";
import { resolveWindowType } from "./resolveWindowType";
import { useUndoRedo } from "./useUndoRedo";
import { useMultiSelect } from "./useMultiSelect";
import { usePersistence } from "./usePersistence";
import {
  createWindowData,
  focusInArray,
  unfocusAllInArray,
  closeInArray,
  restoreInArray,
  duplicateInArray,
  moveInArray,
  resizeInArray,
  clearAllInArray,
  computeOrbitPositions,
  toggleMinimizeInArray,
  toggleMaximizeInArray,
} from "./windowManager";
import type { ArtifactEvent } from "../lib/protocol";
import { fetchArtifact } from "../lib/artifacts";

export interface UseWorkspaceOpts {
  /** Current session id — used to fetch artifact content by id. */
  sessionId?: string | null;
  /**
   * Called when a window is closed; lets the chat store release the full
   * artifact content from memory (keeping only metadata + preview).
   */
  onCloseArtifact?: (artifactId: string) => void;
  /**
   * Called when content is fetched for an artifact; lets the chat store
   * keep its Map in sync so the library list reflects the latest content.
   */
  onContentLoaded?: (artifactId: string, event: ArtifactEvent) => void;
}

export function useWorkspace(opts: UseWorkspaceOpts = {}): import("./types").WorkspaceAPI {
  // Synchronous mirror of `windows` so stable callbacks can read current
  // state without depending on `windows` in their dependency array.
  const windowsRef = useRef<WindowData[]>([]);
  const [windows, setWindows] = useState<WindowData[]>([]);
  windowsRef.current = windows;
  const [gridMode, setGridMode] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const undoRedo = useUndoRedo();
  const selection = useMultiSelect();
  const persistence = usePersistence();

  // Keep the latest sessionId available to async fetches without re-creating
  // the workspace callbacks on every session change.
  const sessionIdRef = useRef<string | null>(opts.sessionId ?? null);
  sessionIdRef.current = opts.sessionId ?? null;
  const onCloseArtifactRef = useRef(opts.onCloseArtifact);
  onCloseArtifactRef.current = opts.onCloseArtifact;
  const onContentLoadedRef = useRef(opts.onContentLoaded);
  onContentLoadedRef.current = opts.onContentLoaded;
  // In-flight content fetches, keyed by artifactId, so we don't double-fetch.
  const fetchingRef = useRef<Set<string>>(new Set());

  /**
   * Fetch the full content of an artifact by id and fill it into the
   * matching window (and notify the chat store). Called when:
   *  - reopening a closed artifact from the library list, or
   *  - reattaching to a session where the artifact was left open.
   */
  const loadArtifactContent = useCallback((artifactId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    if (fetchingRef.current.has(artifactId)) return;
    fetchingRef.current.add(artifactId);
    const controller = new AbortController();
    fetchArtifact(sid, artifactId, controller.signal)
      .then((res) => {
        const ev: ArtifactEvent = {
          event: "artifact",
          id: res.id,
          type: res.type,
          windowType: res.windowType,
          title: res.title,
          content: res.content,
          update: "create",
          language: res.language,
        };
        // Fill the window content (if still open/not closed meanwhile).
        setWindows((prev) => prev.map((w) =>
          w.artifactId === artifactId ? { ...w, content: ev } : w
        ));
        onContentLoadedRef.current?.(artifactId, ev);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        // Revert to closed on failure.
        setWindows((prev) => prev.map((w) =>
          w.artifactId === artifactId ? { ...w, closed: true } : w
        ));
      })
      .finally(() => {
        fetchingRef.current.delete(artifactId);
      });
  }, []);

  // Create a window
  const createWindow = useCallback((type: WindowType, opts?: Partial<CreateWindowOpts>): number => {
    const data = createWindowData({ type, ...opts });
    setWindows((prev) => focusInArray([...prev, data], data.id));
    undoRedo.push({ type: "create", windowId: data.id });
    return data.id;
  }, [undoRedo]);

  // Close a window — hide it and release its content from memory.
  const closeWindow = useCallback((id: number) => {
    undoRedo.push({ type: "close", windowId: id });
    let releasedArtifactId: string | undefined;
    setWindows((prev) => {
      const next = closeInArray(prev, id);
      const closed = next.find((w) => w.id === id);
      if (closed) {
        persistence.saveWindowState(closed);
        releasedArtifactId = closed.artifactId;
        // Drop the heavy content payload from memory; a metadata-only entry
        // (id, type, title, preview) is kept in chat.artifacts so the library
        // list still shows the artifact. Content is re-fetched on reopen.
        return next.map((w) => w.id === id ? { ...w, content: null } : w);
      }
      return next;
    });
    if (releasedArtifactId) onCloseArtifactRef.current?.(releasedArtifactId);
  }, [undoRedo, persistence]);

  // Restore a previously-closed window. If its content was released, fetch it.
  const restoreWindow = useCallback((id: number) => {
    let needFetch = false;
    let artifactId: string | undefined;
    setWindows((prev) => {
      const next = restoreInArray(prev, id);
      const restored = next.find((w) => w.id === id);
      if (restored) {
        persistence.saveWindowState(restored);
        artifactId = restored.artifactId;
        const ev = restored.content as ArtifactEvent | null;
        needFetch = restored.artifactId != null && (ev == null || ev.content == null);
      }
      return next;
    });
    if (needFetch && artifactId) loadArtifactContent(artifactId);
  }, [persistence, loadArtifactContent]);

  // Duplicate a window
  const duplicateWindow = useCallback((id: number) => {
    setWindows((prev) => {
      const { windows: next, newId } = duplicateInArray(prev, id);
      if (newId >= 0) undoRedo.push({ type: "create", windowId: newId });
      return next;
    });
  }, [undoRedo]);

  // Focus a window
  const focusWindow = useCallback((id: number) => {
    setWindows((prev) => focusInArray(prev, id));
  }, []);

  // Unfocus all windows
  const unfocusAll = useCallback(() => {
    setWindows((prev) => unfocusAllInArray(prev));
  }, []);

  // Focus last visible window
  const focusLast = useCallback(() => {
    const visible = windows.filter((w) => !w.closed);
    if (visible.length === 0) return;
    const last = visible[visible.length - 1];
    focusWindow(last.id);
  }, [windows, focusWindow]);

  // Clear all windows
  const clearAll = useCallback(() => {
    const open = windows.filter((w) => !w.closed);
    if (open.length === 0) return;
    undoRedo.push({ type: "clear-all", windows: open });
    setWindows((prev) => clearAllInArray(prev));
  }, [windows, undoRedo]);

  // Toggle grid mode
  const toggleGrid = useCallback(() => {
    setGridMode((g) => !g);
  }, []);

  // Arrange windows in orbit around avatar
  const arrangeOrbit = useCallback(() => {
    const positions = computeOrbitPositions(windows);
    if (positions.length === 0) return;
    setWindows((prev) => {
      let next = prev;
      for (const { id, pos } of positions) {
        next = moveInArray(next, id, pos);
      }
      for (const w of next) {
        if (w.artifactId) persistence.saveWindowState(w);
      }
      return next;
    });
  }, [windows, persistence]);

  // Network pulse (visual feedback — handled by TetherLayer)
  const networkPulse = useCallback(() => {
    window.dispatchEvent(new CustomEvent("kali:network-pulse"));
  }, []);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    setAudioEnabled((a) => !a);
  }, []);

  // Undo/redo action handlers (declared before undo/redo callbacks)
  const handleUndoAction = useCallback((action: UndoAction) => {
    switch (action.type) {
      case "create":
        setWindows((prev) => closeInArray(prev, action.windowId));
        break;
      case "close": {
        // Undoing a close → restore the window and re-fetch its content
        // (the close released the content from memory).
        let fetchId: string | undefined;
        setWindows((prev) => {
          const next = restoreInArray(prev, action.windowId);
          const restored = next.find((w) => w.id === action.windowId);
          if (restored) {
            if (restored.artifactId) fetchId = restored.artifactId;
            if (restored.artifactId) persistence.saveWindowState(restored);
          }
          return next;
        });
        if (fetchId) loadArtifactContent(fetchId);
        break;
      }
      case "move":
        setWindows((prev) => moveInArray(prev, action.windowId, action.prevPos));
        break;
      case "clear-all":
        action.windows.forEach((w) => {
          setWindows((prev) => restoreInArray(prev, w.id));
        });
        // Re-fetch content for restored artifacts that had been released.
        action.windows.forEach((w) => {
          if (w.artifactId) loadArtifactContent(w.artifactId);
        });
        break;
    }
  }, [persistence, loadArtifactContent]);

  const handleRedoAction = useCallback((action: UndoAction) => {
    switch (action.type) {
      case "create":
        setWindows((prev) => restoreInArray(prev, action.windowId));
        break;
      case "close":
        setWindows((prev) => closeInArray(prev, action.windowId));
        break;
      case "move":
        setWindows((prev) => moveInArray(prev, action.windowId, action.newPos));
        break;
      case "clear-all":
        action.windows.forEach((w) => {
          setWindows((prev) => closeInArray(prev, w.id));
        });
        break;
    }
  }, []);

  const undo = useCallback(() => {
    const action = undoRedo.undo();
    if (!action) return;
    handleUndoAction(action);
  }, [undoRedo, handleUndoAction]);

  const redo = useCallback(() => {
    const action = undoRedo.redo();
    if (!action) return;
    handleRedoAction(action);
  }, [undoRedo, handleRedoAction]);

    // Move + resize — persistence is debounced (no localStorage on hot path)
  const moveWindow = useCallback((id: number, pos: Position) => {
    setWindows((prev) => moveInArray(prev, id, pos));
  }, []);

  const resizeWindow = useCallback((id: number, size: Size) => {
    setWindows((prev) => resizeInArray(prev, id, size));
  }, []);

  // Toggle minimize
  const toggleMinimize = useCallback((id: number) => {
    setWindows((prev) => {
      const next = toggleMinimizeInArray(prev, id);
      const toggled = next.find((w) => w.id === id);
      if (toggled) persistence.saveWindowState(toggled);
      return next;
    });
  }, [persistence]);

  // Toggle maximize
  const toggleMaximize = useCallback((id: number) => {
    setWindows((prev) => {
      const next = toggleMaximizeInArray(prev, id);
      const toggled = next.find((w) => w.id === id);
      if (toggled) persistence.saveWindowState(toggled);
      return next;
    });
  }, [persistence]);

  // Persist a single window's layout (debounced). Called on drag/resize end.
  const persistWindow = useCallback((id: number) => {
    const w = windowsRef.current.find((x) => x.id === id);
    if (w) persistence.saveWindowState(w);
  }, [persistence]);

  // Reset workspace — clear all windows and undo/redo stacks
  const resetWorkspace = useCallback(() => {
    setWindows([]);
    undoRedo.clear();
    selection.clearSelection();
  }, [undoRedo, selection]);

  /**
   * Reopen an artifact by its backend id from the library list. If a window
   * already exists, restore + focus it (fetching content if needed); if not,
   * create one and fetch its content. Always ends with the window visible.
   */
  const reopenArtifact = useCallback((artifactId: string) => {
    const existing = windowsRef.current.find((w) => w.artifactId === artifactId);
    if (existing) {
      const ev = existing.content as ArtifactEvent | null;
      const needFetch = ev == null || ev.content == null;
      if (existing.closed) {
        setWindows((prev) => {
          const next = restoreInArray(prev, existing.id);
          const restored = next.find((w) => w.id === existing.id);
          if (restored) persistence.saveWindowState(restored);
          return next;
        });
      } else {
        setWindows((prev) => focusInArray(prev, existing.id));
      }
      if (needFetch) loadArtifactContent(artifactId);
      return;
    }
    // No window yet — this happens when the artifact was never rendered.
    // The chat.artifacts entry has the metadata; create a window from it.
    // NeuralCanvas's sync loop will have already stored the metadata event;
    // we create a minimal open window here and fetch content.
    setWindows((prev) => {
      const data = createWindowData({ type: "widget", title: "…", artifactId, content: null });
      return focusInArray([...prev, data], data.id);
    });
    loadArtifactContent(artifactId);
  }, [persistence, loadArtifactContent]);

  // Save all windows to localStorage
  const saveWorkspace = useCallback(() => {
    for (const w of windows) {
      if (w.artifactId) persistence.saveWindowState(w);
    }
  }, [windows, persistence]);

  // Sync with backend artifacts — creates/updates/closes windows from ArtifactEvent.
  // This callback is stable (no `windows` dependency): it reads current state
  // via setWindows updaters so NeuralCanvas can call it through a ref without
  // stale-closure issues across re-renders.
  const syncArtifact = useCallback((event: ArtifactEvent) => {
    // True close (no phase) → mark window as closed and release content.
    // close+phase:"complete" → update content (streaming finished, render final).
    if (event.update === "close" && event.phase !== "complete") {
      setWindows((prev) => prev.map((w) => w.artifactId === event.id ? { ...w, closed: true, content: null } : w));
      return;
    }
    const isHollow = event.content == null;
    const windowType = resolveWindowType(event);
    const existing = windowsRef.current.find((w) => w.artifactId === event.id);
    if (existing) {
      // Update an existing window.
      setWindows((prev) => prev.map((w) => {
        if (w.artifactId !== event.id) return w;
        if (isHollow) {
          // Metadata-only replay: don't clobber existing live content, but
          // if we had nothing, keep the hollow event as the placeholder.
          const cur = w.content as ArtifactEvent | null;
          if (cur && cur.content != null) return { ...w, content: cur };
          return { ...w, content: event };
        }
        return { ...w, content: event };
      }));
      return;
    }
    // Create a new window from this event.
    const id = createWindow(windowType, {
      title: event.title || windowType,
      artifactId: event.id,
      content: isHollow ? null : event,
    });
    // Restore saved position/size/state if available.
    const saved = persistence.getSavedState(event.id);
    let shouldFetch = false;
    if (saved && id >= 0) {
      setWindows((prev) => prev.map((w) =>
        w.id === id
          ? { ...w, position: saved.position, size: saved.size, minimized: saved.minimized, maximized: saved.maximized, closed: saved.closed, zIndex: saved.zIndex }
          : w
      ));
      // If the artifact was left open and this is a metadata-only replay,
      // fetch the content now.
      shouldFetch = isHollow && !saved.closed;
    } else if (isHollow) {
      // No saved layout: a metadata-only replay with no prior state. Leave it
      // closed (hidden) — the user can reopen it from the library list.
      setWindows((prev) => prev.map((w) => w.id === id ? { ...w, closed: true } : w));
    }
    if (shouldFetch) loadArtifactContent(event.id);
  }, [createWindow, persistence, loadArtifactContent]);

  return useMemo(() => ({
    windows,
    gridMode,
    selectedIds: selection.selectedIds,
    audioEnabled,
    createWindow,
    closeWindow,
    restoreWindow,
    duplicateWindow,
    focusWindow,
    unfocusAll,
    focusLast,
    clearAll,
    toggleGrid,
    arrangeOrbit,
    networkPulse,
    toggleAudio,
    undo,
    redo,
    saveWorkspace,
    resetWorkspace,
    moveWindow,
    resizeWindow,
    persistWindow,
    toggleSelect: selection.toggleSelect,
    clearSelection: selection.clearSelection,
    syncArtifact,
    toggleMinimize,
    toggleMaximize,
    reopenArtifact,
  }), [
    windows, gridMode, selection.selectedIds, audioEnabled,
    createWindow, closeWindow, restoreWindow, duplicateWindow,
    focusWindow, unfocusAll, focusLast, clearAll, toggleGrid, arrangeOrbit,
    networkPulse, toggleAudio, undo, redo, saveWorkspace, resetWorkspace,
    moveWindow, resizeWindow, persistWindow,
    selection.toggleSelect, selection.clearSelection,
    syncArtifact, toggleMinimize, toggleMaximize, reopenArtifact,
  ]);
}