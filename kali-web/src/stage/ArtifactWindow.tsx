import { useRef, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import type { ArtifactWindowData } from "../workspace/types";
import type { ArtifactEvent } from "../lib/protocol";
import { startDrag, startResize } from "../workspace/useDragResize";
import type { ResizeEdge } from "../workspace/useDragResize";
import { useBreakpoint } from "../hooks/useBreakpoint";

const STREAMING_LABEL_KEYS: Record<string, string> = {
  code: "window.streaming.code",
  document: "window.streaming.document",
  diff: "window.streaming.diff",
  html: "window.streaming.html",
  mermaid: "window.streaming.mermaid",
  json: "window.streaming.json",
  table: "window.streaming.table",
  checklist: "window.streaming.checklist",
  chart: "window.streaming.chart",
  quiz: "window.streaming.quiz",
};

function StreamingBadge({ windowType }: { windowType: string }) {
  const { t } = useTranslation();
  const label = t(STREAMING_LABEL_KEYS[windowType] ?? "window.streaming.default") as string;
  return (
    <span className="badge text-accent flex items-center gap-1 shrink-0" title={label}>
      <span className="w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin inline-block" />
      <span className="text-[10px]">{label}</span>
    </span>
  );
}

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
  winScale?: number;
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

function ArtifactWindowImpl({
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
  winScale = 1,
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
    e.currentTarget.setPointerCapture(e.pointerId);
    onFocus();
    const el = elRef.current;
    if (!el) return;
    startResize({
      id: w.id,
      el,
      edge,
      pointerId: e.pointerId,
      startSize: { width: w.size.width, height: w.size.height || 300 },
      startPos: w.position,
      startMouse: { x: e.clientX, y: e.clientY },
      minW,
      minH,
      onResize: (_id, size, pos) => onResize(
        { width: size.width, height: size.height },
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
        style={{ width: (w.size.width * winScale) + "px", maxWidth: "100%" }}
        onPointerDown={onFocus}
        role="region"
        aria-label={w.title}
      >
        <WindowHeader w={w} onClose={onClose} onMinimize={onMinimize} onMaximize={onMaximize} focused={focused} headerActions={headerActions} />
      <div className="aw-body flex-1 flex flex-col min-h-0">{children}</div>
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      data-window-id={w.id}
      className={`aw ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${w.minimized ? "minimized" : ""} ${w.maximized ? "maximized" : ""} entering`}
      style={{
        position: "absolute",
        left: w.position.x + "px",
        top: w.position.y + "px",
        width: (w.size.width * winScale) + "px",
        ...(w.size.height ? { height: (w.size.height * winScale) + "px" } : {}),
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
      <div className="aw-body flex-1 flex flex-col min-h-0">{children}</div>
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

/**
 * Custom comparator for React.memo: re-render only when visual props change.
 * Callbacks (onFocus, onClose, etc.) are inline arrows that change identity
 * on every parent render, but their behavior is stable (bound to window id),
 * so we skip comparing them. This prevents all windows from re-rendering
 * when one window moves or receives focus.
 */
function arePropsEqual(prev: Props, next: Props): boolean {
  const pw = prev.window;
  const nw = next.window;
  if (prev.focused !== next.focused) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.winScale !== next.winScale) return false;
  if (prev.minW !== next.minW) return false;
  if (prev.minH !== next.minH) return false;
  // Shallow compare window fields that affect rendering.
  if (pw.position.x !== nw.position.x || pw.position.y !== nw.position.y) return false;
  if (pw.size.width !== nw.size.width || pw.size.height !== nw.size.height) return false;
  if (pw.zIndex !== nw.zIndex) return false;
  if (pw.closed !== nw.closed) return false;
  if (pw.minimized !== nw.minimized) return false;
  if (pw.maximized !== nw.maximized) return false;
  if (pw.focused !== nw.focused) return false;
  if (pw.title !== nw.title) return false;
  // Content identity: if the content reference is the same, skip.
  // This is the key optimization — during streaming of one window,
  // others keep the same content reference.
  if (pw.content !== nw.content) return false;
  return true;
}

export const ArtifactWindow = memo(ArtifactWindowImpl, arePropsEqual);

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
  const { t } = useTranslation();
  const content = w.content as ArtifactEvent | undefined;
  const isStreaming = content?.phase === "streaming";
  return (
    <div
      ref={headerRef}
      onPointerDown={onDragStart}
      className="aw-header flex items-center justify-between px-3.5 py-2.5 shrink-0"
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
        {isStreaming && <StreamingBadge windowType={w.type} />}
        {focused && !isStreaming && <span className="badge text-accent opacity-70">{t("window.focus")}</span>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {headerActions && <div className="flex items-center gap-0.5 mr-1">{headerActions}</div>}
        {onMaximize && (
          <button
            onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            className="w-6 h-6 rounded hover:bg-accent/10 text-muted hover:text-fg transition flex items-center justify-center"
            aria-label={t("window.maximize")}
            title={t("window.maximize")}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onMinimize(); }}
          className="w-6 h-6 rounded hover:bg-accent/10 text-muted hover:text-fg transition flex items-center justify-center"
          aria-label={t("window.minimize")}
          title={t("window.minimize")}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-6 h-6 rounded hover:bg-err/20 text-muted hover:text-err transition flex items-center justify-center"
          aria-label={t("window.close")}
          title={t("window.close")}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
