/**
 * workspace/useMultiSelect.ts — Lasso + shift-click multi-selection.
 *
 * Manages a Set of selected window ids.  Supports:
 *   - toggleSelect(id) — shift+click toggles individual windows
 *   - clearSelection() — deselect all
 *   - Lasso drag on the canvas background — rectangular selection
 *   - selectAll() — Ctrl+A
 */

import { useState, useCallback, useEffect, useRef } from "react";

export function useMultiSelect() {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const shiftHeld = useRef(false);

  // Track shift key globally
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeld.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeld.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const isSelected = useCallback((id: number) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    toggleSelect,
    clearSelection,
    selectAll,
    isSelected,
  };
}