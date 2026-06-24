/**
 * stage/ArtifactWindow.tsx — A single draggable/resizable window on the canvas.
 *
 * Renders a window with:
 *   - Header (drag handle, icon, title, focus label, minimize, close)
 *   - Body (children — the widget content)
 *   - Resize handle (bottom-right corner)
 *
 * Mobile (<768px) disables drag/resize — windows are positioned by CSS grid.
 */

import { useRef, useCallback } from "react";
import type { ArtifactWindowData } from "../workspace/types";
import { startDrag, startResize } from "../workspace/useDragResize";
import { useBreakpoint } from "../hooks/useBreakpoint";

interface Props {
  window: ArtifactWindowData;
  focused: boolean;
  selected: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMove: (pos: { x: number; y: number }) => void;
  onMoveEnd: (pos: { x: number; y: number }) => void;
  onResize: (size: { width: number; height: number | null }) => void;
  children: React.ReactNode;
  minW?: number;
  minH?: number;
  headerActions?: React.ReactNode;
}

export function ArtifactWindow({
  window: w,
  focused,
  selected,
  onFocus,
  onClose,
  onMinimize,
  onMove,
  onMoveEnd,
  onResize,
  children,
  minW = 260,
  minH = 180,
  headerActions,
}: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const { isMobile } = useBreakpoint();

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if (isMobile) return; // No drag on mobile
    if ((e.target as HTMLElement).closest("button")) return; // Don't drag from buttons
    onFocus();
    const el = elRef.current;
    if (!el) return;
    startDrag({
      id: w.id,
      el,
      startPos: w.position,
      startMouse: { x: e.clientX, y: e.clientY },
      onMove: (_id, pos) => onMove(pos),
      onEnd: (_id, _finalPos, prevPos) => onMoveEnd(prevPos),
      otherWindows: [], // TODO: pass sibling window refs for snap-to-window
      shiftHeld: () => e.shiftKey,
    });
  }, [isMobile, w.id, w.position, onFocus, onMove, onMoveEnd]);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    if (isMobile) return;
    e.stopPropagation();
    onFocus();
    const el = elRef.current;
    if (!el) return;
    startResize({
      id: w.id,
      el,
      startSize: { width: w.size.width, height: w.size.height || 300 },
      startMouse: { x: e.clientX, y: e.clientY },
      minW,
      minH,
      onResize: (_id, size) => onResize({ width: size.width, height: w.size.height === null ? null : size.height }),
    });
  }, [isMobile, w.id, w.size, onFocus, onResize, minW, minH]);

  // Grid mode: position via CSS flex, not absolute
  if (isMobile || (typeof window !== "undefined" && document.body.classList.contains("grid-mode"))) {
    return (
      <div
        ref={elRef}
        data-window-id={w.id}
        className={`aw ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${w.minimized ? "minimized" : ""}`}
        style={{ width: w.size.width + "px", maxWidth: "100%" }}
        onPointerDown={onFocus}
        role="region"
        aria-label={w.title}
      >
        <WindowHeader w={w} onClose={onClose} onMinimize={onMinimize} focused={focused} headerActions={headerActions} />
        <div className="aw-body flex-1 overflow-hidden flex flex-col min-h-0">{children}</div>
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      data-window-id={w.id}
      className={`aw ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${w.minimized ? "minimized" : ""} entering`}
      style={{
        position: "absolute",
        left: w.position.x + "px",
        top: w.position.y + "px",
        width: w.size.width + "px",
        ...(w.size.height ? { height: w.size.height + "px" } : {}),
        zIndex: w.zIndex,
      }}
      onPointerDown={onFocus}
      role="region"
      aria-label={w.title}
      tabIndex={0}
    >
      <WindowHeader
        w={w}
        onClose={onClose}
        onMinimize={onMinimize}
        focused={focused}
        onDragStart={handleDragStart}
        headerRef={headerRef}
        headerActions={headerActions}
      />
      <div className="aw-body flex-1 overflow-hidden flex flex-col min-h-0">{children}</div>
      {/* Resize handle */}
      <div
        className="aw-resize"
        onPointerDown={handleResizeStart}
        aria-label="Redimensionar"
      />
    </div>
  );
}

function WindowHeader({
  w,
  onClose,
  onMinimize,
  focused,
  onDragStart,
  headerRef,
  headerActions,
}: {
  w: ArtifactWindowData;
  onClose: () => void;
  onMinimize: () => void;
  focused: boolean;
  onDragStart?: (e: React.PointerEvent) => void;
  headerRef?: React.RefObject<HTMLDivElement>;
  headerActions?: React.ReactNode;
}) {
  return (
    <div
      ref={headerRef}
      onPointerDown={onDragStart}
      className="aw-header flex items-center justify-between px-3.5 py-2.5 bg-white/[0.03] border-b border-white/8 shrink-0"
      style={{ cursor: onDragStart ? "grab" : "default", userSelect: "none" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* Drag dots */}
        <div className="flex flex-col gap-0.5 mr-1 opacity-20">
          <span className="w-0.75 h-0.75 rounded-full bg-muted" />
          <span className="w-0.75 h-0.75 rounded-full bg-muted" />
          <span className="w-0.75 h-0.75 rounded-full bg-muted" />
        </div>
        {w.icon && <span className="text-sm shrink-0">{w.icon}</span>}
        <span className="badge text-muted truncate">{w.title}</span>
        {focused && <span className="badge text-accent opacity-70">foco</span>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {headerActions && <div className="flex items-center gap-0.5 mr-1">{headerActions}</div>}
        <button
          onClick={(e) => { e.stopPropagation(); onMinimize(); }}
          className="w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-fg transition flex items-center justify-center"
          aria-label="Minimizar"
          title="Minimizar"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-6 h-6 rounded hover:bg-red-500/20 text-muted hover:text-red-300 transition flex items-center justify-center"
          aria-label="Cerrar"
          title="Cerrar"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}