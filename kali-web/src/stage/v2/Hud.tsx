/**
 * stage/v2/Hud.tsx — The four corners of the canvas.
 *
 *   top-left     status pill: dot, what Kali is doing, the model (opens the model stats)
 *   top-right    windows pill: how many windows are open (opens the tray)
 *   bottom-left  notices pill: a new error flashes here, then the pill counts them (opens the list)
 *   bottom-right layout button: modes, views and everything the old HUD carried
 *
 * Pills are placed at the points the zone model gives; in Focus and Mosaic Kali's column carries
 * the status pill and the layout button instead (the same components, positioned statically).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell, Bug, Columns2, Cpu, Gamepad2, Grid2x2, History, Layers, LayoutGrid, Maximize, MessageSquare, Network, Palette, Plus,
  RectangleHorizontal, Search, Settings, Undo2, Volume2, X, Library } from "lucide-react";
import { useStage } from "../StageProvider";
import { ModelStatsPanel } from "../HUD";
import type { ArtifactMode, KaliView, Point } from "../../workspace/layout";
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

export function StatusPill({ style, inline = false }: { style?: CSSProperties; inline?: boolean }) {
  const { t } = useTranslation();
  const { chat, ptt, tts } = useStage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const s = chat.systemStatus;
  const hasProvider = s?.llm_active ?? false;
  const listening = ptt.state === "recording";
  const kind = !hasProvider || chat.status === "error" || chat.status === "disconnected"
    ? "error"
    : listening ? "listening" : chat.isTurnActive || tts.playing ? "working" : chat.status === "ready" ? "ready" : "idle";
  const word = kind === "error"
    ? t(hasProvider ? `status.${chat.status}` : "status.disconnected")
    : kind === "listening" ? t("v2.hud.listening")
    : kind === "working" ? (tts.playing && !chat.isTurnActive ? t("v2.hud.speaking") : t("hud.working"))
    : t(`status.${chat.status}`);
  const model = hasProvider && s ? (s.llm_connection_name || s.llm_model || s.llm_vendor_detected || s.llm_provider) : "—";

  return (
    <div ref={ref} className={inline ? "relative" : "absolute z-40"} style={style}>
      <button type="button" className="v2-pill" style={{ position: "relative" }} onClick={() => setOpen((v) => !v)} aria-expanded={open} title={t("v2.hud.status_hint") as string}>
        <span className={`v2-dot is-${kind}`} aria-hidden="true" />
        <span>{word}</span>
        <span className="v2-pill-sep" aria-hidden="true">·</span>
        <span className="v2-pill-model">{model}</span>
      </button>
      {ptt.wakeWordActive && !inline && (
        <span className="v2-chip mt-2" title={t("wake_word.listening") as string}>{t("wake_word.listening")}</span>
      )}
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
      <Layers size={15} aria-hidden="true" />
      {t("v2.hud.windows", { count })}
    </button>
  );
}

// ── Notices pill ────────────────────────────────────────

export function NoticesPill({ notices, flash, onClear, onDismiss, style }: {
  notices: Notice[];
  flash: Notice | null;
  onClear: () => void;
  onDismiss: (id: number) => void;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div ref={ref} className="absolute z-40" style={style}>
      {open && notices.length > 0 && (
        <div className="v2-pop" style={{ bottom: "calc(100% + 8px)", left: 0 }} role="dialog" aria-label={t("v2.notices.title") as string}>
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
      <button
        type="button"
        className={`v2-pill ${notices.some((n) => n.kind === "error") ? "is-alert" : ""} ${flash ? "is-flash" : ""}`}
        style={{ position: "relative" }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {notices.length ? <span className={`v2-dot ${notices.some((n) => n.kind === "error") ? "is-error" : "is-working"}`} aria-hidden="true" /> : <Bell size={15} aria-hidden="true" />}
        {flash ? <span className="v2-flash-text" role="alert">{flash.text}</span> : t("v2.notices.count", { count: notices.length })}
      </button>
    </div>
  );
}

// ── Layout button and menu ──────────────────────────────

export interface LayoutMenuProps {
  mode: ArtifactMode;
  hasWindows: boolean;
  kaliView: KaliView;
  onMode: (m: ArtifactMode) => void;
  onOverview: () => void;
  onSpace: () => void;
  onKaliView: (v: KaliView) => void;
  onHistory: () => void;
  onCustomize: () => void;
  onJobs: () => void;
  onGames: () => void;
  onNewChat: () => void;
  onSettings: () => void;
  onUndo: () => void;
  onAudio: () => void;
  onDebug?: () => void;
  onPalette: () => void;
  onLibrary: () => void;
  /** Artifacts of this conversation that are not on screen (closed or in the tray). */
  hiddenArtifacts: number;
  runningJobs: number;
}

export const MODE_ICONS: Record<ArtifactMode, typeof Columns2> = {
  split: Columns2,
  focus: RectangleHorizontal,
  mosaic: Grid2x2,
  fullscreen: Maximize,
};
export const MODES: ArtifactMode[] = ["split", "focus", "mosaic", "fullscreen"];

interface MenuItemProps { icon: ReactNode; label: string; kbd?: string; onClick: () => void; checked?: boolean; disabled?: boolean; onClose: () => void }

/** One entry of the layout menu. Declared at module level: a component created inside the menu's
 * render would be a new type on every render, so any re-render between press and release (the
 * canvas re-renders on pointer down) would remount the button and swallow the click. */
function MenuItem({ icon, label, kbd, onClick, checked, disabled, onClose }: MenuItemProps) {
  return (
    <button type="button" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} className="v2-menu-item" onClick={() => { onClose(); onClick(); }} disabled={disabled}>
      {icon}<span>{label}</span>{kbd && <span className="v2-kbd">{kbd}</span>}
    </button>
  );
}

export function LayoutButton({ style, ...p }: LayoutMenuProps & { style?: CSSProperties }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div ref={ref} className="absolute z-40" style={style}>
      {open && (
        <div className="v2-pop" style={{ bottom: "calc(100% + 8px)", right: 0 }} role="menu" aria-label={t("v2.menu.label") as string}>
          <div className="v2-pop-title">{t("v2.menu.layout")}</div>
          {MODES.map((m, i) => {
            const Icon = MODE_ICONS[m];
            return <MenuItem onClose={close} key={m} icon={<Icon size={15} />} label={t(`v2.mode.${m}`)} kbd={`Ctrl ${i + 1}`} onClick={() => p.onMode(m)} checked={p.hasWindows && p.mode === m} disabled={!p.hasWindows} />;
          })}
          <MenuItem onClose={close} icon={<LayoutGrid size={15} />} label={t("v2.menu.overview")} onClick={p.onOverview} />
          <MenuItem onClose={close} icon={<Layers size={15} />} label={t("v2.menu.space")} kbd="Ctrl ⇧ E" onClick={p.onSpace} />
          <MenuItem onClose={close} icon={<Library size={15} />} label={p.hiddenArtifacts ? `${t("v2.menu.library")} · ${p.hiddenArtifacts}` : t("v2.menu.library")} onClick={p.onLibrary} />
          <div className="v2-menu-sep" />
          <div className="v2-pop-title">{t("v2.menu.kali_zone")}</div>
          <MenuItem onClose={close} icon={<Network size={15} />} label={t("v2.view.map")} onClick={() => p.onKaliView("map")} checked={p.kaliView === "map"} />
          <MenuItem onClose={close} icon={<MessageSquare size={15} />} label={t("v2.view.conversation")} onClick={() => p.onKaliView("conversation")} checked={p.kaliView === "conversation"} />
          <div className="v2-menu-sep" />
          <MenuItem onClose={close} icon={<History size={15} />} label={t("stage.history")} onClick={p.onHistory} />
          <MenuItem onClose={close} icon={<Palette size={15} />} label={t("dock.customizer")} onClick={p.onCustomize} />
          <MenuItem onClose={close} icon={<Cpu size={15} />} label={p.runningJobs ? `${t("stage.jobs")} · ${p.runningJobs}` : t("stage.jobs")} onClick={p.onJobs} />
          <MenuItem onClose={close} icon={<Gamepad2 size={15} />} label={t("dock.toys")} onClick={p.onGames} />
          <MenuItem onClose={close} icon={<Volume2 size={15} />} label={t("dock.audio")} onClick={p.onAudio} />
          <MenuItem onClose={close} icon={<Undo2 size={15} />} label={t("dock.undo")} onClick={p.onUndo} />
          <div className="v2-menu-sep" />
          <MenuItem onClose={close} icon={<Plus size={15} />} label={t("stage.new_chat")} onClick={p.onNewChat} />
          <MenuItem onClose={close} icon={<Settings size={15} />} label={t("stage.settings")} onClick={p.onSettings} />
          <MenuItem onClose={close} icon={<Search size={15} />} label={t("v2.menu.palette")} kbd="Ctrl K" onClick={p.onPalette} />
          {p.onDebug && <MenuItem onClose={close} icon={<Bug size={15} />} label={t("dock.debug")} onClick={p.onDebug} />}
        </div>
      )}
      <button type="button" className="v2-square-btn" style={{ position: "relative" }} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label={t("v2.menu.label") as string} title={t("v2.menu.label") as string}>
        {(() => { const Icon = p.hasWindows ? MODE_ICONS[p.mode] : LayoutGrid; return <Icon size={18} aria-hidden="true" />; })()}
      </button>
    </div>
  );
}
