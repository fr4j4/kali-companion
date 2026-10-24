/**
 * stage/v2/CanvasV2.tsx — The neural canvas (desktop): Kali's map, her voice and your artifacts.
 *
 * Measures the stage, asks the zone model for the rectangles of the current mode, and paints:
 *
 *   stage    map with the avatar in the middle, voice line, dock, the corner pills and the
 *            Hub · Studio switch (nothing open, and the Hub's Escucha with its row of cards)
 *   hub      Lámina: Kali's panel on the left and one artifact on the right; Explorar: the
 *            artifact alone with Kali as a bubble; Hilo: the conversation as a column
 *   studio   the group rail, the area's head (group, 1 · 2 · 3 · 4), the panes with their tabs,
 *            Kali's panel on the right
 *
 * Which of the two modes is on, and the Hub's state, come from useCanvasMode; the groups and
 * their panes from useCanvasState. Everything that is not on screen is in the Ctrl+K palette and
 * the dock's «More» menu.
 *
 * The avatar is the real AvatarSVG, mounted once and always at the centre of the map (or the
 * bubble, or the slot of Kali's panel). The board and the Ctrl+K palette sit on top. NeuralCanvas keeps
 * the shared logic (artifact sync, sessions, modals) and mounts this on desktop.
 */

import "./canvas-v2.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownLeft, ArrowLeftRight, Bug, Columns2, Cpu, Eye, Gamepad2, History, LayoutDashboard, LayoutGrid, Maximize2, MessageSquare, Palette, Plus, Search, Settings, Undo2, Volume2, X } from "lucide-react";
import type { WorkspaceAPI } from "../../workspace/types";
import { computeLayout, type CanvasLayout, type Rect } from "../../workspace/layout";
import { useStage } from "../StageProvider";
import { StageDock, type DockMoreItem } from "../StageDock";
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
import { NoticesPill, StatusPill, WindowsPill, anchorStyle } from "./Hud";
import { Board } from "./Board";
import { ConsentCard, VoiceLine, VoiceText, useVoice } from "./KaliZone";
import { OrbList } from "./OrbList";
import { KaliPanel, ModeSeg } from "./KaliPanel";
import { useCanvasMode } from "./useCanvasMode";
import { Fichas } from "./Fichas";
import { ExploreExit, ThreadView } from "./HubViews";
import { GroupRail } from "./GroupChrome";
import { AreaHead, PresetGlyph } from "./AreaHead";
import { StudioPanes, studioView } from "./Pane";
import { DetachButton } from "./Detach";
import { leafOf, splitAt } from "../../workspace/panes";
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
  const { chat, ptt } = useStage();
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
  const lastUserText = useMemo(() => [...chat.messages].reverse().find((m) => m.role === "user" && m.content)?.content ?? null, [chat.messages]);
  const hubActive = useRef(false);
  const canvas = useCanvasState({ api, sessionId: chat.sessionId, isTurnActive: chat.isTurnActive, taskTitle, hubActive });
  const cmode = useCanvasMode({ api, canvas, sessionId: chat.sessionId, lastUserText });
  const inHub = cmode.mode === "hub";
  hubActive.current = inHub;
  const hub = cmode.hub;
  const { active } = canvas;
  const board = canvas.board;
  const groupWindows = useMemo(() => (active ? active.windowIds.map((id) => api.windows.find((w) => w.id === id)).filter((w) => w && !w.closed) : []) as typeof api.windows, [active, api.windows]);
  const { nodes, statuses } = useMapStatuses(groupWindows);
  const winStatus = useWindowStatus(api.windows);
  const notices = useNotices();
  const [picked, setPicked] = useState<NodeId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);

  const groupCount = canvas.groups.groups.length;
  const layout: CanvasLayout = useMemo(() => computeLayout({
    stage,
    // The Studio keeps its panes while any tab is there, even if all of them are out (ghosts).
    visibleWindows: inHub ? (hub.currentId != null ? 1 : 0) : canvas.paneIds.length,
    manualScale: p.manualScale,
    hub: inHub ? hub.state : undefined,
    hubCards: inHub ? hub.previousIds.length : 0,
    groups: groupCount,
  }), [stage, canvas.paneIds.length, p.manualScale, inHub, hub.state, hub.currentId, hub.previousIds.length, groupCount]);
  const mode = layout.mode;
  // The Studio's panes for the active group (null in the Hub or with nothing open).
  const view = useMemo(
    () => (mode === "studio" && active && layout.area && canvas.paneIds.length ? studioView(active, canvas.paneIds, layout.area, layout.k, stage.w, canvas.ghosts) : null),
    [mode, active, layout.area, layout.k, canvas.paneIds, canvas.ghosts, stage.w],
  );
  const [hosts, setHosts] = useState<Record<string, HTMLElement | null>>({});
  const onHost = useCallback((id: string, el: HTMLElement | null) => setHosts((h) => (h[id] === el ? h : { ...h, [id]: el })), []);
  const openCount = api.windows.filter((w) => !w.closed).length;
  const pending = chat.consentRequest && !chat.consentRequest.handled_by_agent ? chat.consentRequest : null;
  // A command's permission is asked inside the terminal when one is on screen; the Kali zone
  // then stays quiet so there is one question (and one countdown), not two.
  const terminalAsks = useMemo(() => {
    if (!pending || (pending.tool !== "run_command" && pending.tool !== "run_tests") || board) return false;
    if (inHub) return hub.currentId != null && !!layout.lamina && api.windows.some((w) => w.id === hub.currentId && !w.closed && w.type === "terminal");
    if (!view) return false;
    const shown = view.leaves.map((l) => l.activeId);
    return shown.some((id) => api.windows.find((w) => w.id === id && !w.closed && w.type === "terminal"));
  }, [pending, board, view, api.windows, inHub, hub.currentId, layout.lamina]);
  const consent = terminalAsks ? null : pending;

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

  /** Ctrl+1…4: one to four panes; from the Hub it is a way into the Studio. */
  const toPreset = useCallback((n: 1 | 2 | 3 | 4) => {
    if (!active) return;
    if (inHub) cmode.enterStudio();
    canvas.toPreset(n);
  }, [active, canvas, inHub, cmode]);

  /** Maximize the pane you are on, or bring the panes back. */
  const toggleZoom = useCallback(() => {
    if (!view) return;
    canvas.zoomPane(view.zoomed ? null : view.activeLeaf);
  }, [view, canvas]);

  const cycleTab = useCallback((dir: 1 | -1) => {
    const leaf = view?.leaves.find((l) => l.id === view.activeLeaf);
    const ids = leaf ? leaf.tabIds.filter((id) => !canvas.ghosts.has(id)) : [];
    if (!leaf || ids.length < 2 || leaf.activeId == null) return;
    const i = ids.indexOf(leaf.activeId);
    canvas.focusWindow(ids[(i + dir + ids.length) % ids.length]);
  }, [view, canvas]);

  const splitRight = useCallback(() => {
    const id = active?.activeId;
    if (!view || id == null) return;
    const leaf = leafOf(view.tree, id);
    if (!leaf || leaf.tabIds.length < 2) return;
    canvas.zoomPane(null);
    canvas.setPanes((tree) => splitAt(tree, leaf.id, "right", id));
  }, [view, active, canvas]);

  const onDetail = useCallback((st: NodeStatus) => {
    const forNode = groupWindows.find((w) => ARTIFACT_NODE[w.type] === st.id || (st.id === "terminal" && w.type === "terminal"));
    if (forNode) { if (inHub) cmode.show(forNode.id); else canvas.focusWindow(forNode.id); return; }
    if (st.id === "memory") { p.onOpenReasoning(); return; }
    // Anything else: the conversation, which is the Hub's Hilo.
    if (!inHub) cmode.enterHub();
    if (!inHub || hub.state !== "hilo") cmode.toggleThread();
  }, [groupWindows, canvas, p, inHub, hub.state, cmode]);

  const back = useCallback((): boolean => {
    if (paletteOpen) { setPaletteOpen(false); return true; }
    if (board) { canvas.setBoard(false); return true; }
    if (bubbleOpen) { setBubbleOpen(false); return true; }
    if (picked) { setPicked(null); return true; }
    if (inHub) return cmode.back();
    if (view?.zoomed) { canvas.zoomPane(null); return true; }
    return false;
  }, [paletteOpen, board, bubbleOpen, picked, canvas, inHub, cmode, view]);

  const explore = useCallback(() => (hub.state === "explorar" ? cmode.back() : cmode.explore()), [hub.state, cmode]);

  useCanvasKeys({
    palette: () => setPaletteOpen((v) => !v),
    // The Hub has no panes: Ctrl+1…4 wait for the Studio.
    preset: (n) => { if (!inHub) toPreset(n); },
    cycleTab: (d) => { if (!inHub) cycleTab(d); },
    splitRight: () => { if (!inHub) splitRight(); },
    closeTab: () => { const id = inHub ? null : active?.activeId; if (id != null) canvas.close(id); },
    windowAt: (i) => {
      if (inHub) { const id = hub.previousIds[i]; if (id != null) cmode.show(id); return; }
      const id = canvas.tabIds[i]; if (id != null) canvas.focusWindow(id);
    },
    board: () => canvas.setBoard(!board),
    zoom: inHub ? explore : toggleZoom,
    toggleMode: cmode.toggleMode,
    back,
  }, api.windows);

  // The active tab of a pane goes to its own window (desktop) or a browser tab.
  const detachButton = useCallback((id: number) => {
    const w = api.windows.find((x) => x.id === id);
    return w?.artifactId ? <DetachButton canvas={canvas} id={id} /> : null;
  }, [api.windows, canvas]);

  const runningJobs = Array.from(chat.jobs.values()).filter((j) => j.status === "running").length;
  const hiddenArtifacts = api.windows.filter((w) => w.artifactId && (w.closed || w.minimized)).length;
  // The dock's «More»: everything the old layout menu carried that is not on screen.
  const more = useMemo<DockMoreItem[]>(() => [
    { id: "palette", icon: <Search size={14} />, label: t("v2.menu.palette"), kbd: "Ctrl K", onClick: () => setPaletteOpen(true) },
    { id: "board", icon: <LayoutDashboard size={14} />, label: t("v2.board.title"), kbd: "Ctrl ⇧ E", onClick: () => canvas.setBoard(true) },
    { id: "library", icon: <LayoutGrid size={14} />, label: hiddenArtifacts ? `${t("v2.menu.library")} · ${hiddenArtifacts}` : t("v2.menu.library"), onClick: p.onOpenLibrary },
    { id: "history", icon: <History size={14} />, label: t("stage.history"), onClick: p.onOpenHistory, separatorBefore: true },
    { id: "customize", icon: <Palette size={14} />, label: t("dock.customizer"), onClick: p.onOpenCustomizer },
    { id: "jobs", icon: <Cpu size={14} />, label: runningJobs ? `${t("stage.jobs")} · ${runningJobs}` : t("stage.jobs"), onClick: p.onOpenJobs },
    { id: "games", icon: <Gamepad2 size={14} />, label: t("dock.toys"), onClick: openToys },
    { id: "audio", icon: <Volume2 size={14} />, label: t("dock.audio"), onClick: api.toggleAudio },
    { id: "undo", icon: <Undo2 size={14} />, label: t("dock.undo"), onClick: api.undo },
    { id: "new", icon: <Plus size={14} />, label: t("stage.new_chat"), onClick: p.onNewSession, separatorBefore: true },
    { id: "settings", icon: <Settings size={14} />, label: t("stage.settings"), onClick: p.onOpenSettings },
    ...(import.meta.env.DEV && p.onToggleDebug ? [{ id: "debug", icon: <Bug size={14} />, label: t("dock.debug"), onClick: p.onToggleDebug }] : []),
  ], [t, canvas, hiddenArtifacts, runningJobs, p, openToys, api.toggleAudio, api.undo]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const out: PaletteCommand[] = [];
    const sWin = t("v2.palette.windows");
    for (const g of canvas.groups.groups) {
      for (const id of g.windowIds) {
        const w = api.windows.find((x) => x.id === id);
        if (!w || w.closed) continue;
        out.push({ id: `w${id}`, section: sWin, label: w.title, keywords: `${g.title} ${w.type}`, icon: <WindowTypeIcon type={w.type} size={16} />, run: () => {
          if (inHub) { cmode.show(id); return; }
          if (g.id !== canvas.groups.activeGroupId) canvas.openGroup(g.id);
          canvas.focusWindow(id);
        } });
      }
    }
    if (inHub) {
      const sPrev = t("v2.panel.previous");
      for (const id of hub.previousIds) {
        const w = api.windows.find((x) => x.id === id && !x.closed);
        if (w) out.push({ id: `p${id}`, section: sPrev, label: t("v2.hub.show", { title: w.title }), keywords: w.type, icon: <Eye size={16} />, run: () => cmode.show(id) });
      }
    }
    // «Traer <artefacto>» for each one in its own window.
    const sOut = t("v2.native.outside");
    for (const id of canvas.ghosts) {
      const w = api.windows.find((x) => x.id === id);
      if (w) out.push({ id: `b${id}`, section: sOut, label: t("v2.native.bring_title", { title: w.title }), keywords: w.type, icon: <ArrowDownLeft size={16} />, run: () => canvas.bring(id) });
    }
    const sGroups = t("v2.palette.groups");
    for (const g of canvas.groups.groups) out.push({ id: `g${g.id}`, section: sGroups, label: g.title, icon: <span className="v2-swatch" style={{ width: 10, height: 10, borderRadius: 3, background: `var(--${g.color})` }} />, run: () => canvas.openGroup(g.id) });
    const sMode = t("v2.menu.layout");
    if (active) {
      ([1, 2, 3, 4] as const).forEach((n) => out.push({ id: `m${n}`, section: sMode, label: t("v2.area.preset", { count: n }), kbd: `Ctrl ${n}`, icon: <PresetGlyph n={n} />, run: () => toPreset(n) }));
      if (!inHub) {
        out.push(
          { id: "split-right", section: sMode, label: t("v2.pane.split_right"), kbd: "Ctrl \\", icon: <Columns2 size={16} />, run: splitRight },
          { id: "zoom", section: sMode, label: t("v2.pane.maximize"), kbd: "Ctrl ⇧ F", icon: <Maximize2 size={16} />, run: toggleZoom },
        );
      }
    }
    const sAct = t("v2.palette.actions");
    out.push(
      { id: "mode", section: sAct, label: t(inHub ? "v2.hub.to_studio" : "v2.hub.to_hub"), kbd: "Ctrl ⇧ T", icon: <ArrowLeftRight size={16} />, run: cmode.toggleMode },
      { id: "board", section: sAct, label: t("v2.board.title"), kbd: "Ctrl ⇧ E", icon: <LayoutDashboard size={16} />, run: () => canvas.setBoard(true) },
    );
    if (inHub) out.push({ id: "thread", section: sAct, label: t(hub.state === "hilo" ? "v2.hub.thread_close" : "v2.hub.thread"), icon: <MessageSquare size={16} />, run: cmode.toggleThread });
    out.push(
      { id: "history", section: sAct, label: t("stage.history"), icon: <History size={16} />, run: p.onOpenHistory },
      { id: "library", section: sAct, label: t("v2.overview.library"), icon: <LayoutGrid size={16} />, run: p.onOpenLibrary },
      { id: "customize", section: sAct, label: t("dock.customizer"), icon: <Palette size={16} />, run: p.onOpenCustomizer },
      { id: "jobs", section: sAct, label: t("stage.jobs"), icon: <Cpu size={16} />, run: p.onOpenJobs },
      { id: "games", section: sAct, label: t("dock.toys"), icon: <Gamepad2 size={16} />, run: openToys },
      { id: "audio", section: sAct, label: t("dock.audio"), icon: <Volume2 size={16} />, run: api.toggleAudio },
      { id: "undo", section: sAct, label: t("dock.undo"), icon: <Undo2 size={16} />, run: api.undo },
      { id: "new", section: sAct, label: t("stage.new_chat"), icon: <Plus size={16} />, run: p.onNewSession },
      { id: "settings", section: sAct, label: t("stage.settings"), icon: <Settings size={16} />, run: p.onOpenSettings },
    );
    if (import.meta.env.DEV && p.onToggleDebug) out.push({ id: "debug", section: sAct, label: t("dock.debug"), icon: <Bug size={16} />, run: p.onToggleDebug });
    return out;
  }, [canvas, api.windows, active, t, toPreset, splitRight, toggleZoom, openToys, p, inHub, hub.previousIds, hub.state, cmode]);

  // ── Pieces ──
  const isColumn = !!layout.column;
  // In the Hub the windows stay mounted in Escucha too, so a card comes back as it was left.
  const showWindows = mode !== "stage" || inHub;
  const kaliZone = layout.kali && !isColumn ? layout.kali : null;
  const mapBusy = Object.values(statuses).some((s) => s.state === "working" || s.state === "recalling");
  const bubbleTone = consent ? "permission" : chat.isTurnActive || mapBusy ? "working" : Object.values(statuses).some((s) => s.state === "done") ? "done" : null;
  const attention = Object.values(statuses).filter((s) => s.state === "permission" || s.state === "failed").length;
  const avatarTone = ptt.state === "recording" || ptt.wakeWordActive ? "listening" : chat.isTurnActive ? "working" : null;

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
      avatarTone={avatarTone}
    />
  );

  const dock = (compact: boolean) => (
    <StageDock api={api} onToggleDebug={p.onToggleDebug} yieldTyping={false} onTypingChange={p.onTypingChange} minimal compact={compact} more={more} />
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
          <WindowLayer
            api={api}
            canvas={canvas}
            layout={layout}
            status={winStatus}
            hub={inHub ? { currentId: hub.currentId, exploring: hub.state === "explorar", onPutDown: cmode.closeLamina, onExplore: explore } : undefined}
            studio={view ? { leaves: view.leaves, hosts, onZoom: (leafId) => canvas.zoomPane(view.zoomed ? null : leafId) } : undefined}
          />
        </ErrorBoundary>
      )}

      {/* Studio: the group rail, the head of the area, the panes' tabs and dividers */}
      {mode === "studio" && layout.rail && <GroupRail canvas={canvas} rect={layout.rail} windows={api.windows} onBoard={() => canvas.setBoard(true)} />}
      {view && layout.areaHead && <AreaHead canvas={canvas} rect={layout.areaHead} view={view} onBoard={() => canvas.setBoard(true)} />}
      {view && !board && (
        <StudioPanes canvas={canvas} view={view} windows={api.windows} status={winStatus.status} k={layout.k} onHost={onHost} extra={detachButton} flash={api.nativeFlash} />
      )}

      {/* Kali's panel (Studio: right; the Hub's Lámina: left, with the cards) */}
      {isColumn && layout.column && (
        <KaliPanel
          side={inHub ? "left" : "right"}
          rect={layout.column}
          k={layout.k}
          taskTitle={active?.title}
          nodes={nodes}
          statuses={statuses}
          onPickOrb={onDetail}
          consent={consentCard}
          dock={dock(true)}
          mode={cmode.mode}
          onSwitchMode={(m) => (m === "hub" ? cmode.enterHub() : cmode.enterStudio())}
          switchEnabled
          voiceOnly={inHub}
          headerExtra={<NoticesPill compact drop="down" notices={notices.notices} flash={notices.flash} onClear={notices.clear} onDismiss={notices.dismiss} />}
        >
          {inHub && <Fichas ids={hub.previousIds} windows={api.windows} layout="column" onShow={cmode.show} onClose={canvas.close} onAll={() => canvas.setBoard(true)} ghosts={canvas.ghosts} />}
        </KaliPanel>
      )}

      {/* Hub: Hilo, the cards of Escucha, the way out of Explorar */}
      {layout.thread && (
        <ThreadView
          rect={layout.thread}
          k={layout.k}
          current={hub.currentId != null ? api.windows.find((w) => w.id === hub.currentId && !w.closed) ?? null : null}
          onOpen={cmode.toggleThread}
          onClose={cmode.toggleThread}
          consent={consentCard}
          dock={dock(true)}
        />
      )}
      {layout.fichas && <Fichas ids={hub.previousIds} windows={api.windows} layout="row" onShow={cmode.show} onClose={canvas.close} onAll={() => canvas.setBoard(true)} ghosts={canvas.ghosts} style={box(layout.fichas)} />}
      {inHub && hub.state === "explorar" && <ExploreExit onExit={cmode.back} style={{ right: 16, top: 16 }} />}

      {/* Map and the avatar (always at its centre) */}
      {map}

      {/* Kali's voice under the map, and her question */}
      {layout.voice && <VoiceLine style={box(layout.voice)} />}
      {kaliZone && consentCard && !layout.thread && (
        <div className="absolute" style={{ zIndex: 45, left: kaliZone.x + Math.max(12, (kaliZone.w - 520 * layout.k) / 2), width: Math.min(kaliZone.w - 24, 520 * layout.k), bottom: stage.h - (kaliZone.y + kaliZone.h) + 12 }}>
          {consentCard}
        </div>
      )}

      {/* Dock */}
      {layout.dock && <div className="v2-dock" style={{ left: layout.dock.x, top: layout.dock.y, width: layout.dock.w }}>{dock(false)}</div>}

      {/* Corners */}
      {layout.statusPill && <StatusPill style={anchorStyle(layout.statusPill, stage, "tl")} />}
      {layout.modeSwitch && !isColumn && (
        <ModeSeg mode={cmode.mode} onSwitch={(m) => (m === "hub" ? cmode.enterHub() : cmode.enterStudio())} style={{ ...anchorStyle(layout.modeSwitch, stage, "tr"), zIndex: 40 }} />
      )}
      {layout.windowsPill && (openCount > 0 || hiddenArtifacts > 0) && (
        <WindowsPill count={openCount} open={board} onToggle={() => canvas.setBoard(!board)} style={anchorStyle(layout.windowsPill, stage, "tr")} />
      )}
      {!isColumn && !(inHub && hub.state === "explorar") && (
        <NoticesPill
          notices={notices.notices}
          flash={notices.flash}
          onClear={notices.clear}
          onDismiss={notices.dismiss}
          style={layout.noticesPill ? anchorStyle(layout.noticesPill, stage, "bl") : { left: (layout.rail?.w ?? 0) + 16, bottom: 16 }}
        />
      )}
      {/* «Dos artefactos · Abrir en el Estudio» (Settings: off by default): under the switch, or above the composer in Kali's panel */}
      {cmode.suggest && (
        <div className="v2-suggest v2-enter" role="status" style={layout.modeSwitch && !isColumn
          ? { ...anchorStyle(layout.modeSwitch, stage, "tr"), top: (layout.modeSwitch.y) + 44 * layout.k }
          : layout.column ? { left: layout.column.x + 16 * layout.k, top: layout.column.y + layout.column.h - 124 * layout.k } : { right: 16, top: 16 }}>
          <span>{t("v2.suggest.text")}</span>
          <button type="button" className="v2-btn is-primary" onClick={() => { cmode.dismissSuggest(); cmode.enterStudio(); }}>{t("v2.suggest.open")}</button>
          <button type="button" className="v2-icon-btn" onClick={cmode.dismissSuggest} aria-label={t("common.close") as string}><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {/* Bubble popover (Explorar, a small window) */}
      {layout.bubble && bubbleOpen && (
        <BubblePopover layout={layout} stage={stage} onClose={() => setBubbleOpen(false)}>
          {consentCard}
          <div className="v2-bubble-card">
            <OrbList nodes={nodes} statuses={statuses} onPick={onDetail} max={4} />
            <BubbleVoice />
          </div>
          <div className="v2-bubble-card" style={{ padding: 6 }}>{dock(true)}</div>
        </BubblePopover>
      )}

      {/* Overlays */}
      {board && (
        <Board
          canvas={canvas}
          windows={api.windows}
          onOpen={(id) => {
            if (inHub) { cmode.show(id); return; }
            const g = canvas.groups.groups.find((x) => x.windowIds.includes(id));
            if (g && g.id !== canvas.groups.activeGroupId) canvas.openGroup(g.id);
            canvas.focusWindow(id);
          }}
          onClose={() => canvas.setBoard(false)}
        />
      )}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
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
