/**
 * stage/v2/CanvasV2.tsx — The neural canvas (desktop): Kali's map, her voice and your artifacts.
 *
 * Measures the stage, asks the zone model for the rectangles of the current mode, and paints:
 *
 *   stage       map with the avatar in the middle, voice line, dock, the four corner controls
 *   split       up to three windows on the left, the map and inspector on the right
 *   focus       group rail, tabs, one window, Kali's column (map, now, voice, composer)
 *   mosaic      the same with panels and dividers
 *   fullscreen  the window alone; the bar and the rail show at the edges; Kali is a bubble
 *
 * The avatar is the real AvatarSVG, mounted once and always at the centre of the map (or the
 * bubble). Espacio, the tray, the overview and the Ctrl+K palette sit on top. NeuralCanvas keeps
 * the shared logic (artifact sync, sessions, modals) and mounts this on desktop.
 */

import "./canvas-v2.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Cpu, Gamepad2, Grid2x2, History, Layers, LayoutGrid, Maximize, MessageSquare, Network, Palette, Plus, RectangleHorizontal, Settings } from "lucide-react";
import type { WorkspaceAPI } from "../../workspace/types";
import { computeLayout, type ArtifactMode, type CanvasLayout, type Rect } from "../../workspace/layout";
import { useStage } from "../StageProvider";
import { StageDock } from "../StageDock";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { WindowTypeIcon } from "../windowIcons";
import { useCanvasState } from "./useCanvasState";
import { useMapStatuses } from "./useMapStatuses";
import { useWindowStatus } from "./useWindowStatus";
import { useNotices } from "./useNotices";
import { useCanvasKeys } from "./useCanvasKeys";
import { WindowLayer } from "./WindowLayer";
import { NeuralMapV2 } from "./NeuralMapV2";
import { ARTIFACT_NODE, type NodeId, type NodeStatus } from "./mapModel";
import { LayoutButton, NoticesPill, StatusPill, WindowsPill, anchorStyle } from "./Hud";
import { ConsentCard, ConversationPanel, Inspector, NowList, VoiceLine, VoiceText, useVoice } from "./KaliZone";
import { FullscreenChrome, GroupRail, MosaicControls, TabBar } from "./GroupChrome";
import { Overview, Tray } from "./ZonePanels";
import { SpaceView } from "./SpaceView";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";

interface Props {
  api: WorkspaceAPI;
  /** The live avatar (AvatarSVG), mounted once. */
  avatar: ReactNode;
  /** Global UI scale from Settings, applied over the automatic scale. */
  manualScale: number;
  onOpenSettings: () => void;
  onOpenJobs: () => void;
  onOpenHistory: () => void;
  onOpenCustomizer: () => void;
  onOpenLibrary: () => void;
  onOpenReasoning: () => void;
  onNewSession: () => void;
  onToggleDebug?: () => void;
  onTypingChange: (typing: boolean) => void;
}

const box = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

export function CanvasV2(p: Props) {
  const { api } = p;
  const { t } = useTranslation();
  const { chat } = useStage();
  const rootRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 1440, h: 900 });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new group is named after what you asked for ("Portada de la web del reloj"), not its first file.
  const taskTitle = useMemo(() => {
    const last = [...chat.messages].reverse().find((m) => m.role === "user" && m.content)?.content.trim().replace(/\s+/g, " ") ?? "";
    return last ? (last.length > 40 ? `${last.slice(0, 39).trimEnd()}…` : last) : null;
  }, [chat.messages]);
  const canvas = useCanvasState({ api, sessionId: chat.sessionId, isTurnActive: chat.isTurnActive, taskTitle });
  const { active, panel, space, kaliView } = canvas;
  const groupWindows = useMemo(() => (active ? active.windowIds.map((id) => api.windows.find((w) => w.id === id)).filter((w) => w && !w.closed) : []) as typeof api.windows, [active, api.windows]);
  const { nodes, statuses } = useMapStatuses(groupWindows);
  const winStatus = useWindowStatus(api.windows);
  const notices = useNotices();
  const [picked, setPicked] = useState<NodeId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);

  const shownCount = canvas.mode === "split" ? canvas.visibleIds.length : canvas.tabIds.length;
  const layout: CanvasLayout = useMemo(() => computeLayout({
    mode: panel ? "split" : canvas.mode,
    stage,
    visibleWindows: panel ? 0 : shownCount,
    kaliView,
    manualScale: p.manualScale,
    zonePanel: !!panel,
  }), [panel, canvas.mode, stage, shownCount, kaliView, p.manualScale]);
  const mode = layout.mode;
  const artifactMode: ArtifactMode = mode === "stage" ? canvas.mode : mode;
  const openCount = api.windows.filter((w) => !w.closed).length;
  const consent = chat.consentRequest && !chat.consentRequest.handled_by_agent ? chat.consentRequest : null;

  // The window title names the task on screen.
  useEffect(() => {
    const prev = document.title;
    document.title = active ? `Kali — ${active.title}` : "Kali";
    return () => { document.title = prev; };
  }, [active?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // A pending question opens the bubble so it is never missed.
  useEffect(() => { if (consent && layout.bubble) setBubbleOpen(true); }, [consent, layout.bubble]);
  useEffect(() => { if (!layout.bubble) setBubbleOpen(false); }, [layout.bubble]);
  // "Type anywhere" reaches Kali through the bubble when she is one.
  useEffect(() => {
    if (!layout.bubble || bubbleOpen) return;
    const open = () => setBubbleOpen(true);
    window.addEventListener("kali:chat-focus", open);
    return () => window.removeEventListener("kali:chat-focus", open);
  }, [layout.bubble, bubbleOpen]);

  const openToys = useCallback(() => {
    const existing = api.windows.find((w) => w.type === "game" && (w.content as { mode?: string } | null)?.mode === "launchpad");
    if (existing && !existing.closed) { canvas.focusWindow(existing.id); return; }
    api.createWindow("game", { title: t("dock.toys"), icon: "\u{1F3AE}", content: { mode: "launchpad" }, resizable: true, minW: 360, minH: 400 });
  }, [api, canvas, t]);

  const setMode = useCallback((m: ArtifactMode) => {
    if (!active) return;
    canvas.setMode(m);
  }, [active, canvas]);

  const toggleFullscreen = useCallback(() => {
    if (!active) return;
    const entering = canvas.mode !== "fullscreen";
    canvas.setMode(entering ? "fullscreen" : "split");
    try {
      if (entering && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      if (!entering && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    } catch { /* not allowed here */ }
  }, [active, canvas]);

  const onDetail = useCallback((st: NodeStatus) => {
    const forNode = groupWindows.find((w) => ARTIFACT_NODE[w.type] === st.id || (st.id === "terminal" && w.type === "terminal"));
    if (forNode) { canvas.focusWindow(forNode.id); return; }
    if (st.id === "memory") { p.onOpenReasoning(); return; }
    canvas.setKaliView("conversation");
  }, [groupWindows, canvas, p]);

  const back = useCallback((): boolean => {
    if (paletteOpen) { setPaletteOpen(false); return true; }
    if (space) { canvas.setSpace(false); return true; }
    if (bubbleOpen) { setBubbleOpen(false); return true; }
    if (panel) { canvas.setPanel(null); return true; }
    if (picked) { setPicked(null); return true; }
    if (active && canvas.mode === "fullscreen") { toggleFullscreen(); return true; }
    if (active && (canvas.mode === "focus" || canvas.mode === "mosaic")) { canvas.setMode("split"); return true; }
    return false;
  }, [paletteOpen, space, bubbleOpen, panel, picked, active, canvas, toggleFullscreen]);

  useCanvasKeys({
    palette: () => setPaletteOpen((v) => !v),
    mode: setMode,
    windowAt: (i) => { const id = canvas.tabIds[i]; if (id != null) canvas.focusWindow(id); },
    space: () => canvas.setSpace(!space),
    fullscreen: toggleFullscreen,
    back,
  }, api.windows);

  const runningJobs = Array.from(chat.jobs.values()).filter((j) => j.status === "running").length;
  const menu = {
    mode: artifactMode,
    hasWindows: !!active && canvas.tabIds.length > 0,
    kaliView,
    onMode: setMode,
    onOverview: () => canvas.setPanel("overview"),
    onSpace: () => canvas.setSpace(true),
    onKaliView: canvas.setKaliView,
    onHistory: p.onOpenHistory,
    onCustomize: p.onOpenCustomizer,
    onJobs: p.onOpenJobs,
    onGames: openToys,
    onNewChat: p.onNewSession,
    onSettings: p.onOpenSettings,
    onUndo: api.undo,
    onAudio: api.toggleAudio,
    onDebug: import.meta.env.DEV ? p.onToggleDebug : undefined,
    onPalette: () => setPaletteOpen(true),
    runningJobs,
  };

  const commands = useMemo<PaletteCommand[]>(() => {
    const out: PaletteCommand[] = [];
    const sWin = t("v2.palette.windows");
    for (const g of canvas.groups.groups) {
      for (const id of g.windowIds) {
        const w = api.windows.find((x) => x.id === id);
        if (!w || w.closed) continue;
        out.push({ id: `w${id}`, section: sWin, label: w.title, keywords: `${g.title} ${w.type}`, icon: <WindowTypeIcon type={w.type} size={15} />, run: () => { if (g.id !== canvas.groups.activeGroupId) canvas.openGroup(g.id); canvas.focusWindow(id); } });
      }
    }
    const sGroups = t("v2.palette.groups");
    for (const g of canvas.groups.groups) out.push({ id: `g${g.id}`, section: sGroups, label: g.title, icon: <span className="v2-swatch" style={{ width: 10, height: 10, borderRadius: 3, background: `var(--${g.color})` }} />, run: () => canvas.openGroup(g.id) });
    const sMode = t("v2.menu.layout");
    if (active) {
      const icons = { split: Columns2, focus: RectangleHorizontal, mosaic: Grid2x2, fullscreen: Maximize };
      (["split", "focus", "mosaic", "fullscreen"] as ArtifactMode[]).forEach((m, i) => { const I = icons[m]; out.push({ id: `m${m}`, section: sMode, label: t(`v2.mode.${m}`), kbd: `Ctrl ${i + 1}`, icon: <I size={15} />, run: () => setMode(m) }); });
    }
    const sAct = t("v2.palette.actions");
    out.push(
      { id: "overview", section: sAct, label: t("v2.menu.overview"), icon: <LayoutGrid size={15} />, run: () => canvas.setPanel("overview") },
      { id: "tray", section: sAct, label: t("v2.tray.title"), icon: <LayoutGrid size={15} />, run: () => canvas.setPanel("tray") },
      { id: "space", section: sAct, label: t("v2.menu.space"), kbd: "Ctrl ⇧ E", icon: <Layers size={15} />, run: () => canvas.setSpace(true) },
      { id: "view", section: sAct, label: kaliView === "map" ? t("v2.view.conversation") : t("v2.view.map"), icon: kaliView === "map" ? <MessageSquare size={15} /> : <Network size={15} />, run: () => canvas.setKaliView(kaliView === "map" ? "conversation" : "map") },
      { id: "history", section: sAct, label: t("stage.history"), icon: <History size={15} />, run: p.onOpenHistory },
      { id: "library", section: sAct, label: t("v2.overview.library"), icon: <LayoutGrid size={15} />, run: p.onOpenLibrary },
      { id: "customize", section: sAct, label: t("dock.customizer"), icon: <Palette size={15} />, run: p.onOpenCustomizer },
      { id: "jobs", section: sAct, label: t("stage.jobs"), icon: <Cpu size={15} />, run: p.onOpenJobs },
      { id: "games", section: sAct, label: t("dock.toys"), icon: <Gamepad2 size={15} />, run: openToys },
      { id: "new", section: sAct, label: t("stage.new_chat"), icon: <Plus size={15} />, run: p.onNewSession },
      { id: "settings", section: sAct, label: t("stage.settings"), icon: <Settings size={15} />, run: p.onOpenSettings },
    );
    return out;
  }, [canvas, api.windows, active, kaliView, t, setMode, openToys, p]);

  // ── Pieces ──
  const isColumn = !!layout.column;
  const showWindows = mode !== "stage";
  const kaliZone = layout.kali && !isColumn ? layout.kali : null;
  const mapBusy = Object.values(statuses).some((s) => s.state === "working" || s.state === "recalling");
  const bubbleTone = consent ? "permission" : chat.isTurnActive || mapBusy ? "working" : Object.values(statuses).some((s) => s.state === "done") ? "done" : null;
  const attention = Object.values(statuses).filter((s) => s.state === "permission" || s.state === "failed").length;

  const map = (
    <NeuralMapV2
      layout={layout}
      nodes={nodes}
      statuses={statuses}
      picked={picked}
      onPick={(id) => setPicked((cur) => (cur === id ? null : id))}
      avatar={p.avatar}
      bubbleTone={bubbleTone}
      bubbleCount={attention}
      onBubble={() => setBubbleOpen((v) => !v)}
      bubbleLabel={t("v2.bubble.label") as string}
    />
  );

  const dock = (compact: boolean) => (
    <StageDock api={api} onToggleDebug={p.onToggleDebug} yieldTyping={false} onTypingChange={p.onTypingChange} minimal compact={compact} />
  );

  const consentCard = consent && (
    <ConsentCard request={consent} onRespond={chat.respondConsent} />
  );

  return (
    <div
      ref={rootRef}
      className={`v2-root is-${mode} ${isColumn ? "is-column" : ""}`}
      style={{ ["--k" as string]: layout.k }}
      data-mode={mode}
    >
      {/* Artifacts */}
      {showWindows && (
        <ErrorBoundary>
          <WindowLayer api={api} canvas={canvas} layout={layout} status={winStatus} />
        </ErrorBoundary>
      )}
      {mode === "mosaic" && !panel && <MosaicControls canvas={canvas} layout={layout} />}

      {/* Group chrome */}
      {(mode === "focus" || mode === "mosaic") && (
        <>
          <GroupRail canvas={canvas} rect={layout.rail} windows={api.windows} onSpace={() => canvas.setSpace(true)} />
          <TabBar canvas={canvas} windows={api.windows} status={winStatus.status} rect={layout.tabs} mode={artifactMode} onOverview={() => { canvas.setMode("split"); canvas.setPanel("overview"); }} />
        </>
      )}
      {mode === "fullscreen" && (
        <FullscreenChrome canvas={canvas} windows={api.windows} status={winStatus.status} layout={layout} onOverview={() => { canvas.setMode("split"); canvas.setPanel("overview"); }} onSpace={() => canvas.setSpace(true)} />
      )}

      {/* Zone panels */}
      {panel === "tray" && layout.artifact && <Tray canvas={canvas} windows={api.windows} rect={layout.artifact} onClose={() => canvas.setPanel(null)} />}
      {panel === "overview" && layout.artifact && <Overview canvas={canvas} windows={api.windows} rect={layout.artifact} onClose={() => canvas.setPanel(null)} onLibrary={p.onOpenLibrary} />}

      {/* Kali's column (focus, mosaic) */}
      {isColumn && layout.column && (
        <aside className="v2-column" style={box(layout.column)} aria-label={t("v2.column.label") as string}>
          <div className="v2-column-head">
            <StatusPill inline />
            <LayoutButton {...menu} style={{ position: "relative" }} />
          </div>
          <div className="v2-column-spacer" aria-hidden="true" />
          <NowList statuses={statuses} groupTitle={active?.title} onPick={(id) => setPicked(id)} />
          {consentCard}
          <ColumnVoice />
          {dock(true)}
        </aside>
      )}

      {/* Map and the avatar (always at its centre) */}
      {map}

      {/* Kali's zone extras: view switch, conversation, inspector, voice */}
      {kaliZone && (
        <div className="v2-seg absolute" style={{ zIndex: 32, right: stage.w - (kaliZone.x + kaliZone.w) + 8, top: kaliZone.y + 8 }} role="group" aria-label={t("v2.menu.kali_zone") as string}>
          <button type="button" aria-pressed={kaliView === "map"} onClick={() => canvas.setKaliView("map")}><Network size={13} aria-hidden="true" />{t("v2.view.map")}</button>
          <button type="button" aria-pressed={kaliView === "conversation"} onClick={() => canvas.setKaliView("conversation")}><MessageSquare size={13} aria-hidden="true" />{t("v2.view.conversation")}</button>
        </div>
      )}
      {kaliZone && kaliView === "conversation" && layout.map && (
        <ConversationPanel style={{ left: kaliZone.x, top: layout.map.y + layout.map.h, width: kaliZone.w, height: kaliZone.y + kaliZone.h - (layout.map.y + layout.map.h) }} />
      )}
      {layout.inspector && <Inspector statuses={statuses} picked={picked} onDetail={onDetail} style={box(layout.inspector)} />}
      {layout.voice && !(kaliView === "conversation" && mode === "stage") && <VoiceLine style={box(layout.voice)} />}
      {kaliZone && consentCard && (
        <div className="absolute" style={{ zIndex: 45, left: kaliZone.x + Math.max(12, (kaliZone.w - 520 * layout.k) / 2), width: Math.min(kaliZone.w - 24, 520 * layout.k), bottom: stage.h - (kaliZone.y + kaliZone.h) + 12 }}>
          {consentCard}
        </div>
      )}

      {/* Dock */}
      {layout.dock && <div className="v2-dock" style={{ left: layout.dock.x, top: layout.dock.y, width: layout.dock.w }}>{dock(false)}</div>}

      {/* Corners */}
      {layout.statusPill && <StatusPill style={anchorStyle(layout.statusPill, stage, "tl")} />}
      {layout.windowsPill && openCount > 0 && (
        <WindowsPill count={openCount} open={panel === "tray"} onToggle={() => canvas.setPanel(panel === "tray" ? null : "tray")} style={anchorStyle(layout.windowsPill, stage, "tr")} />
      )}
      <NoticesPill
        notices={notices.notices}
        flash={notices.flash}
        onClear={notices.clear}
        onDismiss={notices.dismiss}
        style={layout.noticesPill ? anchorStyle(layout.noticesPill, stage, "bl") : { left: (layout.rail?.w ?? 0) + 16, bottom: 16 }}
      />
      {layout.layoutButton && <LayoutButton {...menu} style={anchorStyle(layout.layoutButton, stage, "br")} />}

      {/* Bubble popover (fullscreen, compact) */}
      {layout.bubble && bubbleOpen && (
        <BubblePopover layout={layout} stage={stage} onClose={() => setBubbleOpen(false)}>
          {consentCard}
          <div className="v2-bubble-card">
            <NowList statuses={statuses} groupTitle={active?.title} onPick={setPicked} />
            <BubbleVoice />
          </div>
          <div className="v2-bubble-card" style={{ padding: 6 }}>{dock(true)}</div>
          {mode !== "fullscreen" && <div className="flex justify-end"><LayoutButton {...menu} style={{ position: "relative" }} /></div>}
        </BubblePopover>
      )}

      {/* Overlays */}
      {space && <SpaceView canvas={canvas} windows={api.windows} onClose={() => canvas.setSpace(false)} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function ColumnVoice() {
  const { echo, answer, streaming } = useVoice();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (el && streaming) el.scrollTop = el.scrollHeight; }, [answer, streaming]);
  return (
    <div className="v2-column-voice" ref={ref} aria-live="polite">
      {echo && <div className="v2-echo">“{echo}”</div>}
      {answer && <VoiceText answer={answer} streaming={streaming} />}
    </div>
  );
}

function BubbleVoice() {
  const { answer, streaming } = useVoice();
  if (!answer) return null;
  return (
    <div className="v2-column-voice" style={{ maxHeight: 180, marginTop: 8, fontSize: "max(12px, calc(14px * var(--kt)))" }} aria-live="polite">
      <VoiceText answer={answer.length > 600 && !streaming ? `${answer.slice(0, 600)}…` : answer} streaming={streaming} />
    </div>
  );
}

function BubblePopover({ layout, stage, onClose, children }: { layout: CanvasLayout; stage: { w: number; h: number }; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // Clicks on the bubble itself toggle it; anything else outside closes it (except while Kali asks).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target) || target.closest?.("#avatar-container") || ref.current?.querySelector(".v2-consent")) return;
      onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);
  const b = layout.bubble!;
  return (
    <div
      ref={ref}
      className="v2-bubble-pop v2-enter"
      style={{ right: stage.w - (b.x + b.w), bottom: stage.h - b.y + 10 }}
      role="dialog"
      aria-label={t("v2.bubble.label") as string}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    >
      {children}
    </div>
  );
}
