/**
 * stage/NeuralCanvas.tsx — Root reactive surface (replaces Stage.tsx).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  HUD (top bar: metrics, settings, new, etc.)  │
 *   │                                               │
 *   │            [Avatar + Projection]              │
 *   │                                               │
 *   │            TetherLayer (SVG, behind windows)   │
 *   │            WindowCanvas (floating windows)   │
 *   │                                               │
 *   │            [Dock]                              │
 *   └──────────────────────────────────────────────┘
 *
 * The avatar is always centered (not hidden when content exists).
 * Streaming text appears in the projection area below the avatar.
 * Artifacts from the backend spawn as floating windows on the canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { marked } from "marked";
import { useStage } from "./StageProvider";
import { useAvatarMoodEngine } from "../avatar/AvatarMoodEngine";
import { AvatarSVG } from "../avatar/AvatarSVG";
import { loadAvatarConfig, saveAvatarConfig, type AvatarConfig, type AvatarEmotion } from "../avatar/avatarConfig";
import { useWorkspace } from "../workspace/useWorkspace";
import type { SelectedArtifactRef } from "../lib/protocol";
import { HUD } from "./HUD";
import { PresenceLayer } from "./PresenceLayer";
import { NeuralDock } from "./NeuralDock";
import { TetherLayer } from "./TetherLayer";
import { WindowCanvas } from "./WindowCanvas";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SpotlightInput } from "./SpotlightInput";
import { VoiceBar } from "./VoiceBar";
import { TranscriptionBar } from "./TranscriptionBar";
import { ConversationModal } from "./ConversationModal";
import { CustomizerDrawer } from "./CustomizerDrawer";
import { MinimizeDock } from "./MinimizeDock";
import { SessionDrawer } from "./SessionDrawer";
import { ArtifactModal } from "./ArtifactModal";
import { SettingsModal } from "../components/SettingsModal";
import { ConfigWarningsBanner } from "../components/ConfigWarningsBanner";
import { ConsentModal } from "../components/ConsentModal";
import { JobsPanel } from "../components/JobsPanel";
import { DebugPad } from "./DebugPad";
import { Overlay } from "../components/ui/Overlay";
import { useBreakpoint } from "../hooks/useBreakpoint";
import type { PerformanceProfile } from "../App";
import { usePerfMetrics } from "../hooks/usePerfMetrics";

interface Props {
  theme: string;
  onThemeChange: (t: string) => void;
  performanceProfile: PerformanceProfile;
  onPerformanceProfileChange: (p: PerformanceProfile) => void;
  canvasAutoExpand: boolean;
  onCanvasAutoExpandChange: (v: boolean) => void;
  uiScale: { global: number; text: number; avatar: number; window: number; density: number };
  onUIScaleChange: (patch: Partial<{ global: number; text: number; avatar: number; window: number; density: number }>) => void;
}

export function NeuralCanvas({
  theme,
  onThemeChange,
  performanceProfile,
  onPerformanceProfileChange,
  canvasAutoExpand,
  onCanvasAutoExpandChange,
  uiScale,
  onUIScaleChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const { chat, tts, ptt, configWarnings } = useStage();
  const { isMobile } = useBreakpoint();
  const api = useWorkspace({
    sessionId: chat.sessionId,
    onCloseArtifact: chat.markArtifactClosed,
    onContentLoaded: chat.setArtifactContent,
  });
  const perfMetrics = usePerfMetrics(api.windows, performanceProfile);
  const [typing, setTyping] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSwitcherOpen, setMobileSwitcherOpen] = useState(false);
  const [avatarConfig, setAvatarConfig] = useState<AvatarConfig>(() => loadAvatarConfig());
  const reasoningWindowIdRef = useRef<number | null>(null);

  // Click override — petting the avatar → brief "ronroneando"
  const [overrideEmotion, setOverrideEmotion] = useState<{ emotion: AvatarEmotion; until: number } | null>(null);

  // Scale
  const avScale = uiScale.global * uiScale.avatar;
  const winScale = uiScale.global * uiScale.window;
  const avPx = (isMobile ? (customizerOpen ? 360 : 200) : (customizerOpen ? 580 : 280)) * avScale;
  const ring1Px = (isMobile ? (customizerOpen ? 280 : 160) : (customizerOpen ? 460 : 200)) * avScale;
  const ring2Px = (isMobile ? (customizerOpen ? 230 : 130) : (customizerOpen ? 390 : 170)) * avScale;
  const innerPx = (isMobile ? (customizerOpen ? 300 : 160) : (customizerOpen ? 520 : 220)) * avScale;

  // Mood engine — derives state + emotion from runtime context
  const { state: avatarState, emotion: avatarEmotion } = useAvatarMoodEngine(typing, overrideEmotion);

  useEffect(() => {
    document.documentElement.classList.toggle("kali-mobile-stage", isMobile);
    return () => document.documentElement.classList.remove("kali-mobile-stage");
  }, [isMobile]);

  // NOTE (perf, docs/PERFORMANCE.md §0.5): the avatar mouth is now driven
  // by AvatarSVG's own rAF reading the TTS analyser directly — we no
  // longer lift `audioLevel` into React state here, which previously
  // re-rendered the whole Stage tree on every animation frame while
  // speaking (very expensive on WebKitGTK without GPU compositing).

  // Auto-adaptive input: any printable keypress reveals the text field.
  // Captures the first character in a ref so SpotlightInput can inject it.
  // Suppressed when a game window has focus (games own their keyboard).
  const firstCharRef = useRef("");
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typing) return;
      if (chat.isTurnActive) return;
      if (customizerOpen) return;
      if (apiRef.current.windows.some((w) => w.type === "game" && w.focused)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        firstCharRef.current = e.key;
        setTyping(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing, chat.isTurnActive, customizerOpen]);

  const resetTransientUI = useCallback(() => {
    // Close modals/panels that display session-scoped content and clear refs
    // that point to windows from the previous session.
    setHistoryOpen(false);
    setArtifactsOpen(false);
    setConversationOpen(false);
    setJobsOpen(false);
    setMobileMenuOpen(false);
    setMobileSwitcherOpen(false);
    setTyping(false);
    setOverrideEmotion(null);
    firstCharRef.current = "";
    reasoningWindowIdRef.current = null;
  }, []);

  const newSession = useCallback(() => {
    resetTransientUI();
    // Reset the workspace immediately so open artifact windows and their
    // tethers disappear right away, without waiting for the backend round-trip
    // that delivers the new session id. The session-change effect below will
    // also reset once the new id arrives, but doing it here prevents stale
    // windows from lingering.
    api.resetWorkspace();
    processedRef.current.clear();
    chat.newSession();
    // URL navigation is handled centrally by StageProvider via the
    // isCreatingSession flag set by chat.newSession(). Do not mutate
    // window.location.hash here to avoid racing React's state update.
  }, [chat, api, resetTransientUI]);

  const deleteSession = useCallback((sid: string) => {
    chat.deleteSession(sid);
    if (sid === chat.sessionId) {
      resetTransientUI();
      chat.newSession();
    }
  }, [chat, resetTransientUI]);

  const clearAllSessions = useCallback(() => {
    resetTransientUI();
    chat.clearAllSessions();
    chat.newSession();
  }, [chat, resetTransientUI]);

  const onLanguageChange = useCallback((lang: string) => {
    void i18n.changeLanguage(lang);
    localStorage.setItem("kali.lang", lang);
    chat.updateSettings({ ui_language: lang });
  }, [i18n, chat]);

  // Expose workspace API globally for debugging (dev only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).kaliApi = {
        ...api,
        debug: {
          simulate: (payload: unknown) => chat.wsClient?.simulate(payload as any),
          speakText: (text: string) => chat.wsClient?.send({ event: "tts_speak", text }),
        },
      };
      return () => { delete (window as any).kaliApi; };
    }
  }, [api, chat.wsClient]);

  // Reset workspace when session changes (new session, attach, or refresh resume).
  // Only reset when sessionId actually changes — not when `api` ref recalculates.
  const processedRef = useRef(new Set<string>());
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (chat.sessionId && chat.sessionId !== prevSessionRef.current) {
      prevSessionRef.current = chat.sessionId;
      api.resetWorkspace();
      processedRef.current.clear();
    }
  }, [chat.sessionId, api]);

  // Sync chat.artifacts with workspace windows.
  // "create" events are processed once; "update" events always flow
  // through so streaming content reaches the window; "close" events
  // with phase:"complete" update the window (rendering final content)
  // but keep it open; true close (no phase) cleans up tracking.
  //
  // syncArtifactRef breaks the dependency cycle: syncArtifact closes over
  // `windows`, so when windows changes the useMemo returns a new api with a
  // new syncArtifact. Using a ref avoids re-running this effect when api
  // changes — only chat.artifacts changes (new Map per event) trigger sync.
  const syncArtifactRef = useRef(api.syncArtifact);
  useEffect(() => {
    syncArtifactRef.current = api.syncArtifact;
  }, [api]);

  useEffect(() => {
    const artifacts = chat.artifacts;
    if (!artifacts) return;
    for (const [id, event] of artifacts) {
      if (event.update === "close" && event.phase !== "complete") {
        processedRef.current.delete(id);
        syncArtifactRef.current(event);
        continue;
      }
      if (event.update === "create" && processedRef.current.has(id)) continue;
      processedRef.current.add(id);
      syncArtifactRef.current(event);
    }
  }, [chat.artifacts]);

  // Register a provider so useChat.send can include selected artifact
  // metadata (id, type, title) with each input event. The workspace owns
  // the selectedIds (numeric window ids); we map them to their backend
  // artifactId + type + title here.
  useEffect(() => {
    chat.setSelectedArtifactsProvider(() => {
      const refs: SelectedArtifactRef[] = [];
      for (const winId of api.selectedIds) {
        const win = api.windows.find((w) => w.id === winId);
        if (win?.artifactId) {
          const ev = win.content as { type?: string; title?: string } | undefined;
          refs.push({
            id: win.artifactId,
            type: ev?.type ?? win.type,
            title: win.title,
          });
        }
      }
      return refs;
    });
    return () => chat.setSelectedArtifactsProvider(null);
  }, [chat, api.selectedIds, api.windows]);

  // Avatar click → pet → ronroneando for 3s
  const onAvatarClick = useCallback(() => {
    setOverrideEmotion({ emotion: "ronroneando", until: Date.now() + 3000 });
  }, []);

  const closeMobileSheets = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileSwitcherOpen(false);
  }, []);

  const minimizeFocusedWindow = useCallback(() => {
    const focused = api.windows.find((w) => w.focused && !w.closed && !w.minimized);
    if (focused) {
      api.toggleMinimize(focused.id);
    }
    api.unfocusAll();
    closeMobileSheets();
  }, [api, closeMobileSheets]);

  const openMobileSwitcher = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileSwitcherOpen(true);
  }, []);

  const openMobileMenu = useCallback(() => {
    setMobileSwitcherOpen(false);
    setMobileMenuOpen(true);
  }, []);

  const openWindows = useMemo(() => api.windows.filter((w) => !w.closed), [api.windows]);

  // Unfocus all windows when clicking the canvas background
  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement)?.closest("[data-window-id]")) return;
      api.unfocusAll();
    };
    el.addEventListener("pointerdown", onPointerDown);
    return () => el.removeEventListener("pointerdown", onPointerDown);
  }, [api]);

  return (
    <div ref={canvasRef} className="relative h-full w-full overflow-hidden stage-surface stage-grain">
      {/* Avatar zone — centered, moves up when typing or customizer opens */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-500"
        style={{
          zIndex: customizerOpen || typing ? 60 : 10,
          paddingRight: customizerOpen && !isMobile ? "calc(360px * var(--mul-density))" : "0",
        }}
      >
          {/* Avatar & Rings container */}
          <div className="relative flex items-center justify-center" style={{
            width: avPx,
            height: avPx,
            transform: typing ? "translateY(-35vh)" : "translateY(-18vh)",
            transition: "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
          }}>
          <div className="absolute rounded-full border border-accent/10 transition-all duration-500" style={{
            width: ring1Px,
            height: ring1Px,
            animation: "spin 10s linear infinite",
          }} />
          <div className="absolute rounded-full border border-accent2/20 transition-all duration-500" style={{
            width: ring2Px,
            height: ring2Px,
            animation: "spin 15s linear infinite reverse",
          }} />
          {/* Avatar — pointer-events-auto so clicks work */}
          <div className="relative pointer-events-auto transition-all duration-500" id="avatar-container" style={{
            zIndex: customizerOpen ? 61 : 20,
            width: innerPx,
            height: innerPx,
            filter: customizerOpen || typing ? "drop-shadow(0 0 40px rgba(124,92,255,0.35))" : undefined,
          }}>
            <AvatarSVG
              state={avatarState}
              emotion={avatarEmotion}
              analyser={tts.analyser}
              config={avatarConfig}
              onClick={onAvatarClick}
              typing={typing}
              className="avatar-mount"
            />
          </div>
        </div>
      </div>

      {/* Welcome + transcript — fixed at bottom, NOT affected by avatar growth */}
      <div
        className="absolute inset-x-0 flex flex-col items-center pointer-events-none"
        style={{
          zIndex: customizerOpen ? 60 : 10,
          paddingRight: customizerOpen && !isMobile ? "calc(360px * var(--mul-density))" : "0",
          bottom: "25%",
          opacity: customizerOpen ? 0 : 1,
          pointerEvents: customizerOpen ? "none" : "auto",
          transition: "opacity 0.3s ease, padding-right 0.5s ease",
        }}
      >
        <WelcomeText messages={chat.messages} />
        <FloatingTranscript messages={chat.messages} />
      </div>

      {/* Tether layer — SVG paths avatar→windows */}
      <TetherLayer windows={api.windows} />

      {/* Artifact canvas — floating windows */}
      <ErrorBoundary>
        <WindowCanvas api={api} winScale={winScale} />
      </ErrorBoundary>

      {/* HUD — top bar */}
      <HUD
        isMobile={isMobile}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenJobs={() => { chat.listJobs(); setJobsOpen(true); }}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenCustomizer={() => setCustomizerOpen(true)}
        onOpenArtifacts={() => setArtifactsOpen(true)}
        onOpenConversation={() => setConversationOpen(true)}
        onNewSession={newSession}
        onOpenWindowSwitcher={openMobileSwitcher}
        onOpenMobileMenu={openMobileMenu}
        artifactsOpenCount={api.windows.filter((w) => w.artifactId && !w.closed).length}
        artifactsClosedCount={api.windows.filter((w) => w.artifactId && w.closed).length}
      />

      {/* Presence layer — tool pills + reasoning snippets */}
      <PresenceLayer onExpand={() => {
        const existing = reasoningWindowIdRef.current !== null
          ? api.windows.find(w => w.id === reasoningWindowIdRef.current && !w.closed)
          : null;
        if (existing) {
          api.focusWindow(existing.id);
        } else {
          const id = api.createWindow("reasoning", {
            title: t("reasoning.title"),
            width: 420,
            height: 350,
          });
          reasoningWindowIdRef.current = id;
        }
      }} />

      {/* Spotlight input overlay */}
      <SpotlightInput open={typing} onClose={() => setTyping(false)} firstCharRef={firstCharRef} />

      {/* Voice bar — TTS playback indicator */}
      <VoiceBar />

      {/* Transcription bar — live STT text */}
      <TranscriptionBar />

      {/* Minimize dock — minimized windows */}
      <MinimizeDock windows={api.windows} onRestore={api.toggleMinimize} />

      {/* Dock — bottom input + workspace controls */}
      <NeuralDock
        api={api}
        onToggleDebug={() => setDebugOpen((d) => !d)}
        onOpenTextInput={() => setTyping(true)}
        onOpenWindowSwitcher={openMobileSwitcher}
        onReturnHome={minimizeFocusedWindow}
        isMobile={isMobile}
      />

      {/* Stopped toast */}
      <AnimatePresence>
        {chat.stopped && (
          <motion.div
            className="fixed top-16 left-1/2 -translate-x-1/2 bg-muted text-fg px-4 py-2 rounded-md text-sm z-50 max-w-[90vw] border border-border"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {t("stage.stopped")}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error toasts */}
      <AnimatePresence>
        {chat.error && (
          <motion.div
            className="fixed top-16 left-1/2 -translate-x-1/2 bg-err text-white px-4 py-2 rounded-md text-sm z-50 max-w-[90vw]"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {chat.error}
          </motion.div>
        )}
        {ptt.error && (
          <motion.div
            className="fixed top-16 left-1/2 -translate-x-1/2 bg-err text-white px-4 py-2 rounded-md text-sm z-50 max-w-[90vw]"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {ptt.error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Config warnings banner — settings that couldn't be restored */}
      <ConfigWarningsBanner warnings={configWarnings} onOpenSettings={() => setSettingsOpen(true)} />

      {isMobile && (
        <>
          <Overlay
            open={mobileSwitcherOpen}
            onClose={() => setMobileSwitcherOpen(false)}
            variant="sheet-bottom"
            title={t("stage.windows")}
            showHandle
            panelClassName="mobile-sheet-panel"
          >
            <div className="flex flex-col gap-3">
              <button
                className="dock-btn w-full justify-start gap-2 px-3 py-3"
                onClick={minimizeFocusedWindow}
              >
                <span className="text-base">⌂</span>
                <span className="text-sm">{t("stage.return_home")}</span>
              </button>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted uppercase tracking-wider">{t("stage.open_windows")}</span>
                <span className="badge text-muted">{openWindows.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {openWindows.length === 0 && (
                  <p className="text-sm text-muted py-6 text-center">{t("stage.no_open_windows")}</p>
                )}
                {openWindows.map((w) => {
                  const focused = w.focused && !w.minimized;
                  return (
                    <div key={w.id} className={`rounded-xl border px-3 py-3 flex items-center gap-3 ${focused ? "border-accent bg-accent/10" : "border-border bg-white/[0.03]"}`}>
                      <button
                        className="flex-1 min-w-0 text-left flex items-center gap-3"
                        onClick={() => {
                          if (w.minimized) {
                            api.restoreWindow(w.id);
                          } else {
                            api.focusWindow(w.id);
                          }
                          closeMobileSheets();
                        }}
                      >
                        <span className="text-lg shrink-0">{w.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-fg truncate">{w.title}</span>
                          <span className="block text-[11px] text-muted uppercase tracking-wider">{w.type}</span>
                        </span>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          className="dock-btn w-8 h-8"
                          onClick={() => {
                            api.toggleMinimize(w.id);
                            closeMobileSheets();
                          }}
                          aria-label={t("dock.minimize.restore", { title: w.title }) as string}
                        >
                          {w.minimized ? "↺" : "–"}
                        </button>
                        <button
                          className="dock-btn w-8 h-8 text-red-300"
                          onClick={() => {
                            api.closeWindow(w.id);
                            closeMobileSheets();
                          }}
                          aria-label={t("common.close") as string}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Overlay>

          <Overlay
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            variant="sheet-bottom"
            title={t("stage.mobile_menu")}
            showHandle
            panelClassName="mobile-sheet-panel"
          >
            <div className="grid grid-cols-2 gap-2">
              <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { setHistoryOpen(true); closeMobileSheets(); }}>
                <span>🕘</span>
                <span className="text-sm">{t("stage.history")}</span>
              </button>
              <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { setConversationOpen(true); closeMobileSheets(); }}>
                <span>💬</span>
                <span className="text-sm">{t("dock.conversation")}</span>
              </button>
              <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { setArtifactsOpen(true); closeMobileSheets(); }}>
                <span>📦</span>
                <span className="text-sm">{t("dock.artifacts")}</span>
              </button>
              <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { setSettingsOpen(true); closeMobileSheets(); }}>
                <span>⚙</span>
                <span className="text-sm">{t("stage.settings")}</span>
              </button>
              <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { setCustomizerOpen(true); closeMobileSheets(); }}>
                <span>🎨</span>
                <span className="text-sm">{t("dock.customizer")}</span>
              </button>
              <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { chat.listJobs(); setJobsOpen(true); closeMobileSheets(); }}>
                <span>⏳</span>
                <span className="text-sm">{t("stage.jobs")}</span>
              </button>
              <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { newSession(); closeMobileSheets(); }}>
                <span>＋</span>
                <span className="text-sm">{t("stage.new_chat")}</span>
              </button>
              {import.meta.env.DEV && (
                <button className="dock-btn justify-start gap-2 px-3 py-3" onClick={() => { setDebugOpen(true); closeMobileSheets(); }}>
                  <span>🐞</span>
                  <span className="text-sm">{t("dock.debug")}</span>
                </button>
              )}
            </div>
          </Overlay>
        </>
      )}

      {/* Modals — preserved from Stage */}
      <SessionDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={chat.sessions}
        activeSessionId={chat.sessionId}
        onNewSession={newSession}
        onDeleteSession={deleteSession}
        onClearAllSessions={clearAllSessions}
      />

      <ArtifactModal open={artifactsOpen} onClose={() => setArtifactsOpen(false)} api={api} />

      <ConversationModal open={conversationOpen} onClose={() => setConversationOpen(false)} />

      <CustomizerDrawer
        open={customizerOpen}
        onClose={() => { setCustomizerOpen(false); saveAvatarConfig(avatarConfig); }}
        config={avatarConfig}
        onChange={setAvatarConfig}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        systemStatus={chat.systemStatus}
        onUpdate={chat.updateSettings}
        theme={theme}
        onThemeChange={onThemeChange}
        performanceProfile={performanceProfile}
        onPerformanceProfileChange={onPerformanceProfileChange}
        canvasAutoExpand={canvasAutoExpand}
        onCanvasAutoExpandChange={onCanvasAutoExpandChange}
        uiScale={uiScale}
        onUIScaleChange={onUIScaleChange}
        currentLanguage={i18n.resolvedLanguage ?? "en"}
        onLanguageChange={onLanguageChange}
        downloadTtsModel={chat.downloadTtsModel}
        downloadSttModel={chat.downloadSttModel}
        downloadProgress={chat.downloadProgress}
        downloadError={chat.downloadError}
      />

      <ConsentModal request={chat.consentRequest} onRespond={chat.respondConsent} />

      <JobsPanel
        open={jobsOpen}
        onClose={() => setJobsOpen(false)}
        jobs={chat.jobs}
        onCancelJob={chat.cancelJob}
        onGetLogs={chat.getJobLogs}
      />

      {import.meta.env.DEV && debugOpen && (
        <DebugPad
          onClose={() => setDebugOpen(false)}
          client={chat.wsClient as unknown as { simulate: (payload: unknown) => void; send: (payload: Record<string, unknown>) => void } | null}
          perfMetrics={perfMetrics}
        />
      )}
    </div>
  );
}

/** Ambient welcome text — shown below avatar when no assistant messages. */
function WelcomeText({ messages }: { messages: import("../hooks/useChat").ChatMessage[] }) {
  const { t } = useTranslation();
  const hasAssistantText = messages.some((m) => m.role === "assistant" && m.content);
  if (hasAssistantText) return null;
  return (
    <p className="mt-6 text-center text-muted/50 transition-opacity duration-300 pointer-events-auto" style={{ fontFamily: "Fraunces, serif", fontSize: "calc(1rem * var(--mul-text))", lineHeight: 1.5 }}>
      {t("stage.empty_state")}
    </p>
  );
}

/** Floating transcript — overlay above the dock, narrow, border-left accent.
 *
 * Performance: while the assistant is streaming, we render the raw text
 * (no markdown parsing) updated via a rAF-throttled state. When streaming
 * ends, we parse the final markdown once with marked. This avoids the
 * O(n²) parse-per-token that previously caused UI freezes on long
 * responses.
 */
function FloatingTranscript({ messages }: { messages: import("../hooks/useChat").ChatMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Find the last assistant message with content.
  let text = "";
  let isStreaming = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.content) {
      text = m.content;
      isStreaming = !!m.streaming;
      break;
    }
  }

  // Throttle the visible text during streaming to one update per frame.
  // During streaming, `text` changes every rAF flush (from useChat's
  // batcher), which is already ~60fps. We parse markdown on each update
  // — marked is fast enough for typical response lengths at 60fps.
  const [streamingText, setStreamingText] = useState("");
  const streamingRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      setStreamingText("");
      return;
    }
    if (streamingRafRef.current === null) {
      streamingRafRef.current = requestAnimationFrame(() => {
        streamingRafRef.current = null;
        setStreamingText(text);
      });
    }
    return () => {
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
    };
  }, [text, isStreaming]);

  // Parse markdown — runs on final text when not streaming, or on
  // throttled streaming text during active streaming.
  const displayText = isStreaming ? streamingText : text;

  const html = useMemo(() => {
    if (!displayText) return null;
    try {
      // 1. Collapse 3+ consecutive newlines into 2.
      // 2. Collapse double newlines before list items so bullet lists
      //    don't get excessive paragraph spacing.
      const normalized = displayText
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\n\n(?=\s*[-*]\s|\s*\d+\.\s)/g, "\n");
      return marked.parse(normalized, { async: false }) as string;
    } catch {
      return `<p>${displayText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
    }
  }, [displayText]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [html, atBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    setAtBottom(isAtBottom);
    el.classList.toggle("scrolled-to-bottom", isAtBottom);
  }, []);

  if (!text) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="w-full max-w-lg pointer-events-none mt-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          ref={scrollRef}
          className="projection-scroll max-h-[30vh] border-l-2 border-accent/30 pl-4 pointer-events-auto"
          onScroll={handleScroll}
          aria-live="polite"
          aria-atomic="true"
        >
          {html && (
            <div
              className="leading-relaxed text-sm whitespace-pre-wrap"
              style={{ fontFamily: "Fraunces, serif", fontVariationSettings: '"SOFT" 40' }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {isStreaming && (
            <span className="inline-block w-0.5 h-[1em] bg-accent ml-0.5 align-text-bottom" style={{ animation: "blink 1.1s steps(2,start) infinite" }} />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
