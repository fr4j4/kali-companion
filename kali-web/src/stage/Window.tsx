import { useRef, useCallback, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { WindowData } from "../workspace/types";
import type { ArtifactEvent } from "../lib/protocol";
import { startDrag, startResize } from "../workspace/useDragResize";
import type { ResizeEdge } from "../workspace/useDragResize";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { widgetRegistry } from "../components/widgets/widgetRegistry";
import { SidePanelProvider, type SidePanelContent } from "./SidePanelContext";
import { X } from "lucide-react";

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
  window: WindowData;
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
  /** Aspect ratio (width / height) of the window body to preserve while resizing. */
  bodyAspectRatio?: number;
}

const RESIZE_HANDLES: { edge: ResizeEdge; className: string; label: string }[] = [
  { edge: "n", className: "kw-handle-n", label: "Redimensionar arriba" },
  { edge: "s", className: "kw-handle-s", label: "Redimensionar abajo" },
  { edge: "e", className: "kw-handle-e", label: "Redimensionar derecha" },
  { edge: "w", className: "kw-handle-w", label: "Redimensionar izquierda" },
  { edge: "ne", className: "kw-handle-ne", label: "Redimensionar noreste" },
  { edge: "nw", className: "kw-handle-nw", label: "Redimensionar noroeste" },
  { edge: "se", className: "kw-handle-se", label: "Redimensionar sureste" },
  { edge: "sw", className: "kw-handle-sw", label: "Redimensionar suroeste" },
];

function WindowImpl({
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
  bodyAspectRatio,
}: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { isMobile } = useBreakpoint();

  const panelConfig = widgetRegistry[w.type]?.sidePanel;
  const leftPanelConfig = widgetRegistry[w.type]?.leftSidePanel;
  const hasSidePanel = !!panelConfig || !!leftPanelConfig;

  // Right panel state
  const [sidePanelOpen, setSidePanelOpen] = useState(
    panelConfig?.defaultOpen ?? false
  );
  const [sidePanelWidth, setSidePanelWidth] = useState(
    panelConfig?.defaultWidth ?? 320
  );
  const [sidePanelHeight, setSidePanelHeight] = useState(
    panelConfig?.defaultHeight ?? 400
  );
  const [sidePanelContent, setSidePanelContentState] = useState<SidePanelContent | null>(null);

  // Left panel state
  const [leftPanelOpen, setLeftPanelOpen] = useState(
    leftPanelConfig?.defaultOpen ?? false
  );
  const [leftPanelWidth, setLeftPanelWidth] = useState(
    leftPanelConfig?.defaultWidth ?? 320
  );
  const [leftPanelHeight, setLeftPanelHeight] = useState(
    leftPanelConfig?.defaultHeight ?? 400
  );
  const [leftPanelContent, setLeftPanelContentState] = useState<SidePanelContent | null>(null);

  const toggleSidePanel = useCallback(() => {
    setSidePanelOpen((o) => !o);
  }, []);

  const handleSetSidePanelContent = useCallback((content: SidePanelContent | null) => {
    setSidePanelContentState(content);
  }, []);

  const handleOpenSidePanel = useCallback(() => {
    setSidePanelOpen(true);
  }, []);

  const handleCloseSidePanel = useCallback(() => {
    setSidePanelOpen(false);
  }, []);

  const handleClearSidePanel = useCallback(() => {
    setSidePanelContentState(null);
    setSidePanelOpen(false);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    setLeftPanelOpen((o) => !o);
  }, []);

  const handleSetLeftPanelContent = useCallback((content: SidePanelContent | null) => {
    setLeftPanelContentState(content);
  }, []);

  const handleOpenLeftSidePanel = useCallback(() => {
    setLeftPanelOpen(true);
  }, []);

  const handleCloseLeftSidePanel = useCallback(() => {
    setLeftPanelOpen(false);
  }, []);

  const handleClearLeftPanel = useCallback(() => {
    setLeftPanelContentState(null);
    setLeftPanelOpen(false);
  }, []);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if (isMobile) return;
    if ((e.target as HTMLElement).closest("button")) return;
    onFocus();
    const el = wrapperRef.current;
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
      bodyAspectRatio,
      headerHeight: headerRef.current?.offsetHeight,
      winScale,
      onResize: (_id, size, pos) => onResize(
        { width: size.width, height: size.height },
        pos,
      ),
    });
  }, [isMobile, w.id, w.size, w.position, onFocus, onResize, minW, minH, bodyAspectRatio, winScale]);

  const handlePanelResizeStart = useCallback((e: React.PointerEvent, direction: "e" | "s", isLeft: boolean) => {
    if (isMobile) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startMouse = { x: e.clientX, y: e.clientY };
    const startWidth = isLeft ? leftPanelWidth : sidePanelWidth;
    const startHeight = isLeft ? leftPanelHeight : sidePanelHeight;
    const minW = (isLeft ? leftPanelConfig?.minWidth : panelConfig?.minWidth) ?? 120;
    const minH = (isLeft ? leftPanelConfig?.minHeight : panelConfig?.minHeight) ?? 80;

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startMouse.x;
      const dy = ev.clientY - startMouse.y;
      if (direction === "e") {
        const newWidth = Math.max(minW, startWidth + dx);
        if (isLeft) {
          setLeftPanelWidth(newWidth);
        } else {
          setSidePanelWidth(newWidth);
        }
      } else {
        const newHeight = Math.max(minH, startHeight + dy);
        if (isLeft) {
          setLeftPanelHeight(newHeight);
        } else {
          setSidePanelHeight(newHeight);
        }
      }
    };

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const onPointerCancel = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      e.currentTarget.releasePointerCapture(e.pointerId);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
  }, [isMobile, sidePanelWidth, sidePanelHeight, leftPanelWidth, leftPanelHeight, panelConfig?.minWidth, panelConfig?.minHeight, leftPanelConfig?.minWidth, leftPanelConfig?.minHeight]);

  const panelPosition = panelConfig?.position ?? "right";
  const isMobileFullscreenWindow = isMobile && w.type === "game";

  const sidePanelContextValue = useMemo(() => ({
    setSidePanelContent: handleSetSidePanelContent,
    clearSidePanel: handleClearSidePanel,
    sidePanelContent: sidePanelContent,
    openSidePanel: handleOpenSidePanel,
    closeSidePanel: handleCloseSidePanel,
    setLeftSidePanelContent: handleSetLeftPanelContent,
    clearLeftSidePanel: handleClearLeftPanel,
    leftSidePanelContent: leftPanelContent,
    openLeftSidePanel: handleOpenLeftSidePanel,
    closeLeftSidePanel: handleCloseLeftSidePanel,
  }), [sidePanelContent, leftPanelContent]);

  const renderWindowContent = (content: React.ReactNode) => {
    return (
      <>
        <WindowHeader
          w={w}
          onClose={onClose}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          focused={focused}
          onDragStart={handleDragStart}
          headerRef={headerRef}
          headerActions={headerActions}
          hasSidePanel={hasSidePanel}
          // Right panel
          sidePanelOpen={sidePanelOpen}
          onToggleSidePanel={toggleSidePanel}
          panelIcon={panelConfig?.toggleIcon}
          panelBadge={sidePanelContent?.badge}
          // Left panel
          leftPanelOpen={leftPanelOpen}
          onToggleLeftPanel={toggleLeftPanel}
          leftPanelIcon={leftPanelConfig?.toggleIcon}
          leftPanelBadge={leftPanelContent?.badge}
        />
        <div className="kw-body flex-1 flex flex-col min-h-0">{content}</div>
        {RESIZE_HANDLES.map(({ edge, className, label }) => (
          <div
            key={edge}
            className={`kw-handle ${className}`}
            onPointerDown={(e) => handleResizeStart(e, edge)}
            aria-label={label}
          />
        ))}
      </>
    );
  };

  function renderPanel(
    open: boolean,
    content: SidePanelContent | null,
    position: "left" | "right" | "bottom",
    width: number,
    height: number,
    onClose: () => void,
    isLeft: boolean,
  ) {
    if (!open || !content) return null;
    return (
      <div
        className={`kw-side-panel kw-side-panel-${position}`}
        style={{
          "--panel-width": `${width}px`,
          "--panel-height": `${height}px`,
        } as React.CSSProperties}
      >
        <div className="kw-side-panel-header">
          <div className="flex items-center gap-2">
            {content.icon}
            <span className="text-xs font-medium text-fg/80">{content.title}</span>
          </div>
          <div className="flex items-center gap-1">
            {content.onClear && (
              <button
                onClick={content.onClear}
                className="p-1 rounded hover:bg-white/10 text-muted hover:text-fg transition"
                title="Clear"
              >
                <X size={12} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-white/10 text-muted hover:text-fg transition"
              title="Close panel"
            >
              <X size={12} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{content.content}</div>
        {(position === "right" || position === "left") && (
          <>
            <div
              className={`kw-side-panel-resize kw-side-panel-resize-${position === "left" ? "left" : "right"}`}
              onPointerDown={(e) => handlePanelResizeStart(e, "e", isLeft)}
            />
            <div
              className="kw-side-panel-resize kw-side-panel-resize-top"
              onPointerDown={(e) => handlePanelResizeStart(e, "s", isLeft)}
            />
            <div
              className="kw-side-panel-resize kw-side-panel-resize-bottom"
              onPointerDown={(e) => handlePanelResizeStart(e, "s", isLeft)}
            />
          </>
        )}
        {position === "bottom" && (
          <>
            <div
              className="kw-side-panel-resize kw-side-panel-resize-bottom"
              onPointerDown={(e) => handlePanelResizeStart(e, "s", isLeft)}
            />
            <div
              className="kw-side-panel-resize kw-side-panel-resize-left"
              onPointerDown={(e) => handlePanelResizeStart(e, "e", isLeft)}
            />
            <div
              className="kw-side-panel-resize kw-side-panel-resize-right"
              onPointerDown={(e) => handlePanelResizeStart(e, "e", isLeft)}
            />
          </>
        )}
      </div>
    );
  }

  const leftPos = leftPanelConfig?.position ?? "left";

  if (isMobile || (typeof window !== "undefined" && document.body.classList.contains("grid-mode"))) {
    return (
      <SidePanelProvider value={sidePanelContextValue}>
        <div className="kw-wrapper">
          {!w.maximized && !isMobileFullscreenWindow && renderPanel(leftPanelOpen, leftPanelContent, leftPos, leftPanelWidth, leftPanelHeight, toggleLeftPanel, true)}
          <div
            ref={elRef}
            data-window-id={w.id}
            data-window-type={w.type}
            className={`kw ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${w.minimized ? "minimized" : ""} ${isMobileFullscreenWindow ? "mobile-game-shell" : ""}`}
            style={
              isMobileFullscreenWindow
                ? {
                    position: "fixed",
                    inset: 0,
                    width: "100vw",
                    height: "100dvh",
                    borderRadius: 0,
                    zIndex: 9999,
                  }
                : {
                    width: `min(${w.size.width * winScale}px, calc(100vw - 12px))`,
                    maxWidth: "calc(100vw - 12px)",
                    maxHeight: "calc(100dvh - 176px)",
                    margin: "0 auto",
                  }
            }
            onPointerDown={onFocus}
            role="region"
            aria-label={w.title}
          >
            {renderWindowContent(children)}
          </div>
          {!w.maximized && !isMobileFullscreenWindow && renderPanel(sidePanelOpen, sidePanelContent, panelPosition, sidePanelWidth, sidePanelHeight, toggleSidePanel, false)}
        </div>
      </SidePanelProvider>
    );
  }

  return (
    <SidePanelProvider value={sidePanelContextValue}>
      <div
        ref={wrapperRef}
        className="kw-wrapper"
        style={{
          position: "absolute",
          left: w.position.x + "px",
          top: w.position.y + "px",
          zIndex: w.zIndex,
        }}
      >
        {!w.maximized && renderPanel(leftPanelOpen, leftPanelContent, leftPos, leftPanelWidth, leftPanelHeight, toggleLeftPanel, true)}
        <div
          ref={elRef}
          data-window-id={w.id}
          data-window-type={w.type}
          className={`kw ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${w.minimized ? "minimized" : ""} ${w.maximized ? "maximized" : ""} entering`}
          style={{
            width: (w.size.width * winScale) + "px",
            ...(w.size.height ? { height: (w.size.height * winScale) + "px" } : {}),
          }}
          onPointerDown={onFocus}
          role="region"
          aria-label={w.title}
          tabIndex={0}
        >
          {renderWindowContent(children)}
        </div>
        {!w.maximized && renderPanel(sidePanelOpen, sidePanelContent, panelPosition, sidePanelWidth, sidePanelHeight, toggleSidePanel, false)}
      </div>
    </SidePanelProvider>
  );
}

export const KaliWindow = WindowImpl;

function WindowHeader({
  w,
  onClose,
  onMinimize,
  onMaximize,
  focused,
  onDragStart,
  headerRef,
  headerActions,
  hasSidePanel,
  // Right panel
  sidePanelOpen,
  onToggleSidePanel,
  panelIcon,
  panelBadge,
  // Left panel
  leftPanelOpen,
  onToggleLeftPanel,
  leftPanelIcon,
  leftPanelBadge,
}: {
  w: WindowData;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize?: () => void;
  focused: boolean;
  onDragStart?: (e: React.PointerEvent) => void;
  headerRef?: React.RefObject<HTMLDivElement>;
  headerActions?: React.ReactNode;
  hasSidePanel?: boolean;
  sidePanelOpen?: boolean;
  onToggleSidePanel?: () => void;
  panelIcon?: React.ReactNode;
  panelBadge?: number;
  leftPanelOpen?: boolean;
  onToggleLeftPanel?: () => void;
  leftPanelIcon?: React.ReactNode;
  leftPanelBadge?: number;
}) {
  const { t } = useTranslation();
  const content = w.content as ArtifactEvent | undefined;
  const isStreaming = content?.phase === "streaming";
  return (
    <div
      ref={headerRef}
      onPointerDown={onDragStart}
      className="kw-header flex items-center justify-between px-3.5 py-2.5 shrink-0"
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
        {/* Left panel toggle */}
        {hasSidePanel && onToggleLeftPanel && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleLeftPanel(); }}
            className={`p-1 rounded transition flex items-center justify-center relative ${leftPanelOpen ? "bg-accent/20 text-accent" : "hover:bg-white/10 text-muted hover:text-fg"}`}
            title="Toggle reasoning panel"
          >
            {leftPanelIcon ?? <span className="text-xs">&#9776;</span>}
            {!!leftPanelBadge && !leftPanelOpen && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center">
                {leftPanelBadge > 9 ? "9+" : leftPanelBadge}
              </span>
            )}
          </button>
        )}
        {/* Right panel toggle */}
        {hasSidePanel && onToggleSidePanel && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSidePanel(); }}
            className={`p-1 rounded transition flex items-center justify-center relative ${sidePanelOpen ? "bg-accent/20 text-accent" : "hover:bg-white/10 text-muted hover:text-fg"}`}
            title="Toggle debug panel"
          >
            {panelIcon ?? <span className="text-xs">&#9776;</span>}
            {!!panelBadge && !sidePanelOpen && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center">
                {panelBadge > 9 ? "9+" : panelBadge}
              </span>
            )}
          </button>
        )}
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
