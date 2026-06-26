/**
 * workspace/useWorkspace.ts — Orchestration hook for the spatial workspace.
 *
 * Combines all sub-hooks (undo/redo, multi-select, persistence, keyboard)
 * and exposes a unified WorkspaceAPI.  NeuralCanvas consumes this hook to
 * manage the artifact canvas.
 */

import { useState, useCallback, useMemo } from "react";
import type {
  ArtifactWindowData,
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

export function useWorkspace(): import("./types").WorkspaceAPI {
  const [windows, setWindows] = useState<ArtifactWindowData[]>([]);
  const [gridMode, setGridMode] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const undoRedo = useUndoRedo();
  const selection = useMultiSelect();
  const persistence = usePersistence();

  // Create a window
  const createWindow = useCallback((type: WindowType, opts?: Partial<CreateWindowOpts>): number => {
    const data = createWindowData({ type, ...opts });
    setWindows((prev) => focusInArray([...prev, data], data.id));
    undoRedo.push({ type: "create", windowId: data.id });
    return data.id;
  }, [undoRedo]);

  // Close a window
  const closeWindow = useCallback((id: number) => {
    undoRedo.push({ type: "close", windowId: id });
    setWindows((prev) => {
      const next = closeInArray(prev, id);
      const closed = next.find((w) => w.id === id);
      if (closed) persistence.saveWindowState(closed);
      return next;
    });
  }, [undoRedo, persistence]);

  // Restore a closed window
  const restoreWindow = useCallback((id: number) => {
    setWindows((prev) => {
      const next = restoreInArray(prev, id);
      const restored = next.find((w) => w.id === id);
      if (restored) persistence.saveWindowState(restored);
      return next;
    });
  }, [persistence]);

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
      case "close":
        setWindows((prev) => restoreInArray(prev, action.windowId));
        break;
      case "move":
        setWindows((prev) => moveInArray(prev, action.windowId, action.prevPos));
        break;
      case "clear-all":
        action.windows.forEach((w) => {
          setWindows((prev) => restoreInArray(prev, w.id));
        });
        break;
    }
  }, []);

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

    // Move + resize
  const moveWindow = useCallback((id: number, pos: Position) => {
    setWindows((prev) => {
      const next = moveInArray(prev, id, pos);
      const moved = next.find((w) => w.id === id);
      if (moved) persistence.saveWindowState(moved);
      return next;
    });
  }, [persistence]);

  const resizeWindow = useCallback((id: number, size: Size) => {
    setWindows((prev) => {
      const next = resizeInArray(prev, id, size);
      const resized = next.find((w) => w.id === id);
      if (resized) persistence.saveWindowState(resized);
      return next;
    });
  }, [persistence]);

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

  // Reset workspace — clear all windows and undo/redo stacks
  const resetWorkspace = useCallback(() => {
    setWindows([]);
    undoRedo.clear();
    selection.clearSelection();
  }, [undoRedo, selection]);

  // Save all windows to localStorage
  const saveWorkspace = useCallback(() => {
    for (const w of windows) {
      if (w.artifactId) persistence.saveWindowState(w);
    }
  }, [windows, persistence]);

  // Sync with backend artifacts — creates/updates/closes windows from ArtifactEvent
  const syncArtifact = useCallback((event: ArtifactEvent) => {
    // True close (no phase) → mark window as closed.
    // close+phase:"complete" → update content (streaming finished, render final).
    if (event.update === "close" && event.phase !== "complete") {
      setWindows((prev) => prev.map((w) => w.artifactId === event.id ? { ...w, closed: true } : w));
      return;
    }
    const windowType = resolveWindowType(event);
    const existing = windows.find((w) => w.artifactId === event.id);
    if (existing) {
      // Update content
      setWindows((prev) => prev.map((w) => w.artifactId === event.id ? { ...w, content: event } : w));
    } else {
      // Create new window
      const id = createWindow(windowType, {
        title: event.title || windowType,
        artifactId: event.id,
        content: event,
      });
      // Restore saved position/size/state if available
      const saved = persistence.getSavedState(event.id);
      if (saved && id >= 0) {
        setWindows((prev) => prev.map((w) =>
          w.id === id
            ? { ...w, position: saved.position, size: saved.size, minimized: saved.minimized, maximized: saved.maximized, closed: saved.closed, zIndex: saved.zIndex }
            : w
        ));
      }
    }
  }, [windows, createWindow, persistence]);

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
    toggleSelect: selection.toggleSelect,
    clearSelection: selection.clearSelection,
    syncArtifact,
    toggleMinimize,
    toggleMaximize,
  }), [
    windows, gridMode, selection.selectedIds, audioEnabled,
    createWindow, closeWindow, restoreWindow, duplicateWindow,
    focusWindow, focusLast, clearAll, toggleGrid, arrangeOrbit,
    networkPulse, toggleAudio, undo, redo, saveWorkspace, resetWorkspace,
    moveWindow, resizeWindow, selection.toggleSelect, selection.clearSelection,
    syncArtifact, toggleMinimize, toggleMaximize,
  ]);
}