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
  const persistence = usePersistence(windows);

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
    setWindows((prev) => closeInArray(prev, id));
  }, [undoRedo]);

  // Restore a closed window
  const restoreWindow = useCallback((id: number) => {
    setWindows((prev) => restoreInArray(prev, id));
  }, []);

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
      return next;
    });
  }, [windows]);

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
    setWindows((prev) => moveInArray(prev, id, pos));
  }, []);

  const resizeWindow = useCallback((id: number, size: Size) => {
    setWindows((prev) => resizeInArray(prev, id, size));
  }, []);

  // Toggle minimize
  const toggleMinimize = useCallback((id: number) => {
    setWindows((prev) => toggleMinimizeInArray(prev, id));
  }, []);

  // Toggle maximize
  const toggleMaximize = useCallback((id: number) => {
    setWindows((prev) => toggleMaximizeInArray(prev, id));
  }, []);

  // Save workspace
  const saveWorkspace = useCallback(() => {
    persistence.save();
  }, [persistence]);

  // Sync with backend artifacts — creates/updates/closes windows from ArtifactEvent
  const syncArtifact = useCallback((event: ArtifactEvent) => {
    if (event.update === "close") {
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
      void id;
    }
  }, [windows, createWindow]);

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
    networkPulse, toggleAudio, undo, redo, saveWorkspace,
    moveWindow, resizeWindow, selection.toggleSelect, selection.clearSelection,
    syncArtifact, toggleMinimize, toggleMaximize,
  ]);
}