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
 *   │            ArtifactCanvas (floating windows)   │
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
import { ArtifactCanvas } from "./ArtifactCanvas";
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
import { useBreakpoint } from "../hooks/useBreakpoint";

interface Props {
  theme: string;
  onThemeChange: (t: string) => void;
  canvasAutoExpand: boolean;
  onCanvasAutoExpandChange: (v: boolean) => void;
  uiScale: { global: number; text: number; avatar: number; window: number; density: number };
  onUIScaleChange: (patch: Partial<{ global: number; text: number; avatar: number; window: number; density: number }>) => void;
}

export function NeuralCanvas({ theme, onThemeChange, canvasAutoExpand, onCanvasAutoExpandChange, uiScale, onUIScaleChange }: Props) {
  const { t, i18n } = useTranslation();
  const { chat, tts, ptt, configWarnings } = useStage();
  const { isMobile } = useBreakpoint();
  const api = useWorkspace({
    sessionId: chat.sessionId,
    onCloseArtifact: chat.markArtifactClosed,
    onContentLoaded: chat.setArtifactContent,
  });
  const [typing, setTyping] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
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

  const newSession = useCallback(() => {
    setHistoryOpen(false);
    chat.newSession();
    window.location.hash = "#/";
  }, [chat]);

  const deleteSession = useCallback((sid: string) => {
    chat.deleteSession(sid);
    if (sid === chat.sessionId) {
      chat.newSession();
      window.location.hash = "#/";
    }
  }, [chat]);

  const clearAllSessions = useCallback(() => {
    chat.clearAllSessions();
    chat.newSession();
    window.location.hash = "#/";
  }, [chat]);

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
            transform: typing ? "translateY(-20vh)" : "translateY(0)",
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
        <ArtifactCanvas api={api} winScale={winScale} />
      </ErrorBoundary>

      {/* HUD — top bar */}
      <HUD
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenJobs={() => { chat.listJobs(); setJobsOpen(true); }}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenCustomizer={() => setCustomizerOpen(true)}
        onOpenArtifacts={() => setArtifactsOpen(true)}
        onOpenConversation={() => setConversationOpen(true)}
        onNewSession={newSession}
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
        <DebugPad onClose={() => setDebugOpen(false)} client={chat.wsClient as unknown as { simulate: (payload: unknown) => void; send: (payload: Record<string, unknown>) => void } | null} />
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

/** Floating transcript — overlay above the dock, narrow, border-left accent. */
function FloatingTranscript({ messages }: { messages: import("../hooks/useChat").ChatMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

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

  const html = useMemo(() => {
    if (!text) return null;
    try {
      return marked.parse(text, { async: false }) as string;
    } catch {
      return `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
    }
  }, [text]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [html, isStreaming, atBottom]);

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
              className="leading-relaxed text-sm"
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