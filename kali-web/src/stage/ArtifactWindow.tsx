import { useRef, useCallback } from "react";
import type { ArtifactWindowData } from "../workspace/types";
import { startDrag, startResize } from "../workspace/useDragResize";
import type { ResizeEdge } from "../workspace/useDragResize";
import { useBreakpoint } from "../hooks/useBreakpoint";

interface Props {
  window: ArtifactWindowData;
  focused: boolean;
  selected: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize?: () => void;
  onMove: (pos: { x: number; y: number }) => void;
  onMoveEnd: (pos: { x: number; y: number }) => void;
  onResize: (size: { width: number; height: number | null }, pos?: { x: number; y: number }) => void;
  children: React.ReactNode;
  minW?: number;
  minH?: number;
  headerActions?: React.ReactNode;
}

const RESIZE_HANDLES: { edge: ResizeEdge; className: string; label: string }[] = [
  { edge: "n", className: "aw-handle-n", label: "Redimensionar arriba" },
  { edge: "s", className: "aw-handle-s", label: "Redimensionar abajo" },
  { edge: "e", className: "aw-handle-e", label: "Redimensionar derecha" },
  { edge: "w", className: "aw-handle-w", label: "Redimensionar izquierda" },
  { edge: "ne", className: "aw-handle-ne", label: "Redimensionar noreste" },
  { edge: "nw", className: "aw-handle-nw", label: "Redimensionar noroeste" },
  { edge: "se", className: "aw-handle-se", label: "Redimensionar sureste" },
  { edge: "sw", className: "aw-handle-sw", label: "Redimensionar suroeste" },
];

export function ArtifactWindow({
  window: w,
  focused,
  selected,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
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
    if (isMobile) return;
    if ((e.target as HTMLElement).closest("button")) return;
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
      otherWindows: [],
      shiftHeld: () => e.shiftKey,
    });
  }, [isMobile, w.id, w.position, onFocus, onMove, onMoveEnd]);

  const handleResizeStart = useCallback((e: React.PointerEvent, edge: ResizeEdge) => {
    if (isMobile) return;
    e.stopPropagation();
    onFocus();
    const el = elRef.current;
    if (!el) return;
    startResize({
      id: w.id,
      el,
      edge,
      startSize: { width: w.size.width, height: w.size.height || 300 },
      startPos: w.position,
      startMouse: { x: e.clientX, y: e.clientY },
      minW,
      minH,
      onResize: (_id, size, pos) => onResize(
        { width: size.width, height: w.size.height === null ? null : size.height },
        pos,
      ),
    });
  }, [isMobile, w.id, w.size, w.position, onFocus, onResize, minW, minH]);

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
        <WindowHeader w={w} onClose={onClose} onMinimize={onMinimize} onMaximize={onMaximize} focused={focused} headerActions={headerActions} />
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
        onMaximize={onMaximize}
        focused={focused}
        onDragStart={handleDragStart}
        headerRef={headerRef}
        headerActions={headerActions}
      />
      <div className="aw-body flex-1 overflow-hidden flex flex-col min-h-0">{children}</div>
      {RESIZE_HANDLES.map(({ edge, className, label }) => (
        <div
          key={edge}
          className={`aw-handle ${className}`}
          onPointerDown={(e) => handleResizeStart(e, edge)}
          aria-label={label}
        />
      ))}
    </div>
  );
}

function WindowHeader({
  w,
  onClose,
  onMinimize,
  onMaximize,
  focused,
  onDragStart,
  headerRef,
  headerActions,
}: {
  w: ArtifactWindowData;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize?: () => void;
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
        {onMaximize && (
          <button
            onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            className="w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-fg transition flex items-center justify-center"
            aria-label="Maximizar"
            title="Maximizar"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        )}
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
