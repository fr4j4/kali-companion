/**
 * workspace/useUndoRedo.ts — Undo/redo stack for workspace actions.
 *
 * Maintains two stacks (undo + redo) with a configurable limit.  Each action
 * is a discriminated union (create/close/move/resize/clear-all) carrying
 * enough data to reverse or replay the operation.
 */

import { useState, useCallback, useRef } from "react";
import type { UndoAction } from "./types";

const DEFAULT_LIMIT = 50;

export function useUndoRedo(limit = DEFAULT_LIMIT) {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  // Mirror stacks in refs so undo()/redo() can pop synchronously.
  const undoRef = useRef<UndoAction[]>([]);
  const redoRef = useRef<UndoAction[]>([]);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const push = useCallback((action: UndoAction) => {
    setUndoStack((prev) => {
      const next = [...prev, action];
      if (next.length > limit) next.shift();
      undoRef.current = next;
      return next;
    });
    setRedoStack([]);
    redoRef.current = [];
  }, [limit]);

  const undo = useCallback<() => UndoAction | null>(() => {
    const stack = undoRef.current;
    if (stack.length === 0) return null;
    const popped = stack[stack.length - 1];
    const nextUndo = stack.slice(0, -1);
    const nextRedo = [...redoRef.current, popped];
    undoRef.current = nextUndo;
    redoRef.current = nextRedo;
    setUndoStack(nextUndo);
    setRedoStack(nextRedo);
    return popped;
  }, []);

  const redo = useCallback<() => UndoAction | null>(() => {
    const stack = redoRef.current;
    if (stack.length === 0) return null;
    const popped = stack[stack.length - 1];
    const nextRedo = stack.slice(0, -1);
    const nextUndo = [...undoRef.current, popped];
    undoRef.current = nextUndo;
    redoRef.current = nextRedo;
    setRedoStack(nextRedo);
    setUndoStack(nextUndo);
    return popped;
  }, []);

  const clear = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return { push, undo, redo, clear, canUndo, canRedo };
}