/**
 * stage/v2/Hud.tsx — The four corners of the canvas.
 *
 *   top-left     status pill: dot, what Kali is doing, the model (opens the model stats)
 *   top-right    windows pill: how many windows are open (opens the board)
 *   bottom-left  notices pill: a new error flashes here, then the pill counts them (opens the list)
 *
 * Pills are placed at the points the zone model gives; where Kali's panel is on screen it carries
 * the status and the notices instead. Everything the old layout menu held is in the Ctrl+K
 * palette and the dock's «More» menu.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Bell, LayoutDashboard, X } from "lucide-react";
import { useStage } from "../StageProvider";
import { ModelStatsPanel } from "../HUD";
import type { Point } from "../../workspace/layout";
import type { Notice } from "./useNotices";

// ── Shared: dismiss a popover on outside click or Escape ─────────

export function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); };
  }, [open, close, ref]);
}

/** Absolute style for a pill anchored at a corner point of the stage. */
export function anchorStyle(p: Point, stage: { w: number; h: number }, corner: "tl" | "tr" | "bl" | "br"): CSSProperties {
  const s: CSSProperties = {};
  if (corner === "tl" || corner === "bl") s.left = p.x; else s.right = stage.w - p.x;
  if (corner === "tl" || corner === "tr") s.top = p.y; else s.bottom = stage.h - p.y;
  return s;
}

// ── Status pill ─────────────────────────────────────────

export type KaliStatusKind = "error" | "listening" | "working" | "ready" | "idle";

/** What Kali is doing now, in one word, and the model she runs on: the status pill and the panel. */
export function useKaliStatus(): { kind: KaliStatusKind; word: string; model: string } {
  const { t } = useTranslation();
  const { chat, ptt, tts } = useStage();
  const s = chat.systemStatus;
  const hasProvider = s?.llm_active ?? false;
  const listening = ptt.state === "recording";
  const kind: KaliStatusKind = !hasProvider || chat.status === "error" || chat.status === "disconnected"
    ? "error"
    : listening ? "listening" : chat.isTurnActive || tts.playing ? "working" : chat.status === "ready" ? "ready" : "idle";
  const word = kind === "error"
    ? t(hasProvider ? `status.${chat.status}` : "status.disconnected")
    : kind === "listening" ? t("v2.hud.listening")
    : kind === "working" ? (tts.playing && !chat.isTurnActive ? t("v2.hud.speaking") : t("hud.working"))
    : t(`status.${chat.status}`);
  const model = hasProvider && s ? (s.llm_connection_name || s.llm_model || s.llm_vendor_detected || s.llm_provider) : "—";
  return { kind, word, model };
}

export function StatusPill({ style, inline = false }: { style?: CSSProperties; inline?: boolean }) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const s = chat.systemStatus;
  const { kind, word, model } = useKaliStatus();

  return (
    <div ref={ref} className={inline ? "relative" : "absolute z-40"} style={style}>
      <button type="button" className="v2-pill" style={{ position: "relative" }} onClick={() => setOpen((v) => !v)} aria-expanded={open} title={t("v2.hud.status_hint") as string}>
        <span className={`v2-dot is-${kind}`} aria-hidden="true" />
        <span>{word}</span>
        <span className="v2-pill-sep" aria-hidden="true">·</span>
        <span className="v2-pill-model">{model}</span>
      </button>
      {open && s && (
        <ModelStatsPanel
          className="absolute left-0 top-full mt-2"
          systemStatus={s}
          turnStats={chat.turnStats}
          messageCount={chat.messages.length}
          artifactCount={chat.artifacts.size}
          toolCallCount={chat.toolEvents.length}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ── Windows pill ────────────────────────────────────────

export function WindowsPill({ count, open, onToggle, style }: { count: number; open: boolean; onToggle: () => void; style?: CSSProperties }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="v2-pill" style={style} onClick={onToggle} aria-expanded={open} title={t("v2.hud.windows_hint") as string}>
      <LayoutDashboard size={16} aria-hidden="true" />
      {t("v2.hud.windows", { count })}
    </button>
  );
}

// ── Notices pill ────────────────────────────────────────

export function NoticesPill({ notices, flash, onClear, onDismiss, style, drop = "up", compact = false }: {
  notices: Notice[];
  flash: Notice | null;
  onClear: () => void;
  onDismiss: (id: number) => void;
  style?: CSSProperties;
  /** Where the list opens: above (corners) or below (a panel header). */
  drop?: "up" | "down";
  /** Icon only (a panel header), the count as a badge. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div ref={ref} className={compact ? "relative" : "absolute z-40"} style={style}>
      {open && notices.length > 0 && (
        <div className="v2-pop" style={drop === "up" ? { bottom: "calc(100% + 8px)", left: 0 } : { top: "calc(100% + 8px)", right: 0 }} role="dialog" aria-label={t("v2.notices.title") as string}>
          <div className="flex items-center justify-between">
            <div className="v2-pop-title">{t("v2.notices.title")}</div>
            <button type="button" className="v2-btn is-quiet" onClick={() => { onClear(); setOpen(false); }}>{t("v2.notices.clear")}</button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {[...notices].reverse().map((n) => (
              <div key={n.id} className="v2-notice">
                <span className={`v2-dot is-${n.kind === "error" ? "error" : "working"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {n.text}
                  <small>{new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                </span>
                <button type="button" className="v2-icon-btn sm" onClick={() => onDismiss(n.id)} aria-label={t("common.close") as string}><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {compact ? (
        <button
          type="button"
          className={`v2-icon-btn v2-notice-btn ${notices.some((n) => n.kind === "error") ? "is-alert" : ""} ${flash ? "is-flash" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={(flash?.text ?? t("v2.notices.count", { count: notices.length })) as string}
          title={(flash?.text ?? t("v2.notices.count", { count: notices.length })) as string}
        >
          <Bell size={16} aria-hidden="true" />
          {notices.length > 0 && <span className="v2-notice-badge" aria-hidden="true">{notices.length}</span>}
          {flash && <span className="sr-only" role="alert">{flash.text}</span>}
        </button>
      ) : <button
        type="button"
        className={`v2-pill ${notices.some((n) => n.kind === "error") ? "is-alert" : ""} ${flash ? "is-flash" : ""}`}
        style={{ position: "relative" }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {notices.length ? <span className={`v2-dot ${notices.some((n) => n.kind === "error") ? "is-error" : "is-working"}`} aria-hidden="true" /> : <Bell size={16} aria-hidden="true" />}
        {flash ? <span className="v2-flash-text" role="alert">{flash.text}</span> : t("v2.notices.count", { count: notices.length })}
      </button>}
    </div>
  );
}
