/**
 * stage/v2/ArtifactShell.tsx — The common window frame of every artifact type.
 *
 *   ┌────────────────────────────────────────────────────────────┐ ← 2 px progress line
 *   │ [icon] Title                ● Status    [actions] │ – ×    │  52 px header
 *   │        subtitle                                            │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ body (the widget)                                          │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ footer facts · Updated 2 s ago                             │  30 px footer
 *   └────────────────────────────────────────────────────────────┘
 *
 * No maximize: Focus and Fullscreen replace it. The frame is placed by the canvas (a rectangle
 * from the zone model); it never unmounts when hidden, so a window keeps its scroll and state
 * across modes, and moving between rectangles is a FLIP transform (instant in performance).
 */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minus, X } from "lucide-react";
import type { WindowData } from "../../workspace/types";
import type { ArtifactEvent } from "../../lib/protocol";
import type { Rect } from "../../workspace/layout";
import { flip } from "../../lib/motion";
import { WindowTypeIcon } from "../windowIcons";
import { widgetRegistry } from "../../components/widgets/widgetRegistry";
import { SidePanelProvider, type SidePanelContent } from "../SidePanelContext";
import { ShellContext, type ShellApi, type ShellStatus } from "./shell";
import { useRelativeTime } from "./useRelativeTime";

export type ShellChrome = "window" | "bare";

interface Props {
  window: WindowData;
  rect: Rect | null;
  z: number;
  focused: boolean;
  /** Small mosaic panel: result only. */
  compact?: boolean;
  chrome?: ShellChrome;
  /** Status from the canvas (consent, terminal running…); the widget may override it. */
  status?: ShellStatus | null;
  /** Real progress (0–1) from the artifact event. */
  progress?: number | null;
  /** When the content last changed (ms). */
  updatedAt?: number;
  onFocus: () => void;
  onMinimize: () => void;
  onClose: () => void;
  /** Double click on the header: work on it in Focus. */
  onExpand?: () => void;
  headerActions?: ReactNode;
  children: ReactNode;
}

const STATUS_KEY: Record<string, string> = {
  writing: "v2.status.writing",
  permission: "v2.status.permission",
  updating: "v2.status.updating",
  running: "v2.status.running",
  done: "v2.status.done",
  saved: "v2.status.saved",
  error: "v2.status.error",
};

/** Default subtitle from the content when the widget gives none. */
function defaultSubtitle(w: WindowData, t: (k: string, o?: Record<string, unknown>) => string): string {
  const ev = w.content as ArtifactEvent | null;
  const typeLabel = t(`v2.type.${w.type}`, { defaultValue: w.type });
  if (!ev || typeof ev !== "object" || !("content" in ev)) return typeLabel;
  const text = typeof ev.content === "string" ? ev.content : "";
  if (w.type === "code" && text) {
    const lines = text.split("\n").length;
    return [ev.language, t("v2.subtitle.lines", { count: lines })].filter(Boolean).join(" · ");
  }
  if (w.type === "document" && text) {
    const words = text.replace(/[#*>`_-]+/g, " ").split(/\s+/).filter(Boolean).length;
    return t("v2.subtitle.words", { count: words });
  }
  return typeLabel;
}

function ArtifactShellImpl({
  window: w, rect, z, focused, compact = false, chrome = "window", status, progress, updatedAt,
  onFocus, onMinimize, onClose, onExpand, headerActions, children,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const prevRect = useRef<Rect | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  const [toolbarEl] = useState<HTMLElement | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [ownStatus, setOwnStatus] = useState<ShellStatus | null>(null);
  const [ownProgress, setOwnProgress] = useState<number | null>(null);
  const [sample, setSample] = useState(false);
  const hidden = rect == null;

  // FLIP between rectangles; first placement and hide/show are instant.
  useLayoutEffect(() => {
    const el = ref.current;
    const prev = prevRect.current;
    if (el && prev && rect && (prev.x !== rect.x || prev.y !== rect.y || prev.w !== rect.w || prev.h !== rect.h)) {
      flip(el, prev, rect);
    }
    if (rect) prevRect.current = rect;
  }, [rect]);

  const shell = useMemo<ShellApi>(() => ({
    actionsEl, footerEl, toolbarEl, compact,
    setSubtitle, setStatus: setOwnStatus, setProgress: setOwnProgress, setSample,
  }), [actionsEl, footerEl, toolbarEl, compact]);

  // Side panels (HTML console, game logs) dock inside the frame instead of floating outside it.
  const panelCfg = widgetRegistry[w.type]?.sidePanel;
  const leftCfg = widgetRegistry[w.type]?.leftSidePanel;
  const [right, setRight] = useState<SidePanelContent | null>(null);
  const [left, setLeft] = useState<SidePanelContent | null>(null);
  const [rightOpen, setRightOpen] = useState(panelCfg?.defaultOpen ?? false);
  const [leftOpen, setLeftOpen] = useState(leftCfg?.defaultOpen ?? false);
  const sideValue = useMemo(() => ({
    setSidePanelContent: setRight,
    clearSidePanel: () => { setRight(null); setRightOpen(false); },
    sidePanelContent: right,
    openSidePanel: () => setRightOpen(true),
    closeSidePanel: () => setRightOpen(false),
    setLeftSidePanelContent: setLeft,
    clearLeftSidePanel: () => { setLeft(null); setLeftOpen(false); },
    leftSidePanelContent: left,
    openLeftSidePanel: () => setLeftOpen(true),
    closeLeftSidePanel: () => setLeftOpen(false),
  }), [right, left]);

  const effStatus = ownStatus ?? status ?? null;
  const effProgress = ownProgress ?? progress ?? null;
  const working = effStatus?.kind === "writing" || effStatus?.kind === "updating" || effStatus?.kind === "running";
  const updated = useRelativeTime(updatedAt);
  const sub = subtitle ?? defaultSubtitle(w, t as never);

  const onHeaderDouble = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    onExpand?.();
  }, [onExpand]);

  const panel = (content: SidePanelContent | null, open: boolean, side: "left" | "right", close: () => void) => {
    if (!open || !content) return null;
    return (
      <aside className={`v2-side v2-side-${side}`} aria-label={content.title}>
        <div className="v2-side-head">
          <span className="flex items-center gap-2">{content.icon}<span>{content.title}</span></span>
          <span className="flex items-center gap-1">
            {content.onClear && <button type="button" className="v2-icon-btn sm" onClick={content.onClear} aria-label={t("window.clear") as string} title={t("window.clear") as string}><X size={12} /></button>}
            <button type="button" className="v2-icon-btn sm" onClick={close} aria-label={t("window.close_panel") as string} title={t("window.close_panel") as string}><X size={12} /></button>
          </span>
        </div>
        <div className="v2-side-body">{content.content}</div>
      </aside>
    );
  };

  return (
    <div
      ref={ref}
      data-window-id={w.id}
      data-window-type={w.type}
      className={`v2-shell ${focused ? "is-focused" : ""} ${compact ? "is-compact" : ""} ${chrome === "bare" ? "is-bare" : ""} ${hidden ? "is-hidden" : "v2-enter"}`}
      style={rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z } : { zIndex: 0 }}
      onPointerDown={hidden ? undefined : onFocus}
      role="region"
      aria-label={w.title}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : 0}
    >
      {(working || effProgress != null) && (
        <div className={`v2-progress ${effProgress == null ? "is-indeterminate" : ""}`} aria-hidden="true">
          <span style={{ width: effProgress == null ? "100%" : `${Math.round(Math.max(0, Math.min(1, effProgress)) * 100)}%` }} />
        </div>
      )}
      {chrome === "window" && (
        <header className="v2-shell-head" onDoubleClick={onHeaderDouble}>
          <span className="v2-type-tile" aria-hidden="true"><WindowTypeIcon type={w.type} size={16} /></span>
          <span className="min-w-0 flex flex-col">
            <span className="v2-shell-title truncate">{w.title}</span>
            {!compact && sub && <span className="v2-shell-sub truncate">{sub}</span>}
          </span>
          {effStatus && !compact && (
            <span className={`v2-status-pill is-${effStatus.kind}`} role="status">
              <span className="v2-dot" aria-hidden="true" />
              {effStatus.label ?? t(STATUS_KEY[effStatus.kind] ?? "v2.status.updating", { context: w.type })}
            </span>
          )}
          <span className="flex-1" />
          <span className="v2-shell-actions" ref={setActionsEl} />
          {headerActions}
          <span className="v2-sep" aria-hidden="true" />
          <button type="button" className="v2-icon-btn" onClick={(e) => { e.stopPropagation(); onMinimize(); }} aria-label={t("window.minimize") as string} title={t("window.minimize") as string}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="v2-icon-btn is-close" onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label={t("window.close") as string} title={t("window.close") as string}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
      )}
      <ShellContext.Provider value={shell}>
        <SidePanelProvider value={sideValue}>
          <div className="v2-shell-main">
            {panel(left, leftOpen, "left", () => setLeftOpen(false))}
            <div className="v2-shell-body">{children}</div>
            {panel(right, rightOpen, "right", () => setRightOpen(false))}
          </div>
        </SidePanelProvider>
      </ShellContext.Provider>
      {!compact && chrome === "window" && (
        <footer className="v2-shell-foot">
          <span className="v2-foot-slot" ref={setFooterEl} />
          {(right && !rightOpen) && (
            <button type="button" className="v2-foot-btn" onClick={() => setRightOpen(true)}>{right.icon}{right.title}{right.badge ? ` · ${right.badge}` : ""}</button>
          )}
          {(left && !leftOpen) && (
            <button type="button" className="v2-foot-btn" onClick={() => setLeftOpen(true)}>{left.icon}{left.title}</button>
          )}
          <span className="flex-1" />
          {sample && <span className="v2-foot-item is-warn">{t("v2.footer.sample")}</span>}
          {updated && <span className="v2-foot-item">{t("v2.footer.updated", { when: updated })}</span>}
        </footer>
      )}
    </div>
  );
}

export const ArtifactShell = memo(ArtifactShellImpl);
