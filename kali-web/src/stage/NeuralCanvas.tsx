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
import { ConversationModal } from "./ConversationModal";
import { CustomizerDrawer } from "./CustomizerDrawer";
import { MinimizeDock } from "./MinimizeDock";
import { ClosedArtifactsBar } from "./ClosedArtifactsBar";
import { SessionDrawer } from "./SessionDrawer";
import { ArtifactModal } from "./ArtifactModal";
import { SettingsModal } from "../components/SettingsModal";
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
  const { chat, tts, ptt, voices } = useStage();
  const { isMobile } = useBreakpoint();
  const api = useWorkspace();
  const [typing, setTyping] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [avatarConfig, setAvatarConfig] = useState<AvatarConfig>(() => loadAvatarConfig());

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
  const firstCharRef = useRef("");
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (typing) return;
      if (chat.isTurnActive) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        firstCharRef.current = e.key;
        setTyping(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typing, chat.isTurnActive]);

  const newSession = useCallback(() => {
    setHistoryOpen(false);
    chat.newSession();
    window.location.hash = "#/";
  }, [chat]);

  const onLanguageChange = useCallback((lang: string) => {
    void i18n.changeLanguage(lang);
    localStorage.setItem("kali.lang", lang);
  }, [i18n]);

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
  // clean up the tracking set so the same artifact ID can be re-used.
  useEffect(() => {
    const artifacts = chat.artifacts;
    if (!artifacts) return;
    for (const [id, event] of artifacts) {
      if (event.update === "close") {
        processedRef.current.delete(id);
        api.syncArtifact(event);
        continue;
      }
      if (event.update === "create" && processedRef.current.has(id)) continue;
      processedRef.current.add(id);
      api.syncArtifact(event);
    }
  }, [chat.artifacts, api]);

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

  return (
    <div className="relative h-full w-full overflow-hidden stage-surface stage-grain">
      {/* Avatar zone — Always centered in available space */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none transition-all duration-500"
        style={{
          zIndex: customizerOpen ? 60 : 10,
          paddingRight: customizerOpen && !isMobile ? "calc(360px * var(--mul-density))" : "0",
        }}
      >
        {/* Avatar & Rings container */}
        <div className="relative flex items-center justify-center transition-all duration-500" style={{
          width: avPx,
          height: avPx,
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
            filter: customizerOpen ? "drop-shadow(0 0 40px rgba(124,92,255,0.35))" : undefined,
          }}>
            <AvatarSVG
              state={avatarState}
              emotion={avatarEmotion}
              analyser={tts.analyser}
              config={avatarConfig}
              onClick={onAvatarClick}
              className="avatar-mount"
            />
          </div>
        </div>
        {/* Projection area — only visible when customizer is CLOSED */}
        {!customizerOpen && (
          <div className="mt-4 px-10 py-8 rounded-3xl max-w-2xl w-full shadow-2xl border border-accent/10 projection-surface pointer-events-none" aria-live="polite" aria-atomic="true">
            <ProjectionText messages={chat.messages} />
          </div>
        )}
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
        onNewSession={newSession}
        onLanguageChange={onLanguageChange}
        currentLanguage={i18n.language}
      />

      {/* Presence layer — tool pills + reasoning snippets */}
      <PresenceLayer />

      {/* Spotlight input overlay */}
      <SpotlightInput open={typing} onClose={() => setTyping(false)} firstCharRef={firstCharRef} />

      {/* Voice bar — TTS playback indicator */}
      <VoiceBar />

      {/* Minimize dock — minimized windows */}
      <MinimizeDock windows={api.windows} onRestore={api.toggleMinimize} />

      {/* Closed artifacts bar — restore closed windows */}
      <ClosedArtifactsBar windows={api.windows} onRestore={api.restoreWindow} />

      {/* Dock — bottom input + workspace controls */}
      <NeuralDock
        api={api}
        onToggleDrawer={() => setArtifactsOpen(true)}
        onToggleCustomizer={() => setCustomizerOpen(true)}
        onToggleConversation={() => setConversationOpen(true)}
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
            {t("stage.stopped") || "Cancelled"}
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

      {/* Modals — preserved from Stage */}
      <SessionDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={chat.sessions}
        activeSessionId={chat.sessionId}
        onNewSession={newSession}
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
        voices={voices}
        onUpdate={chat.updateSettings}
        theme={theme}
        onThemeChange={onThemeChange}
        canvasAutoExpand={canvasAutoExpand}
        onCanvasAutoExpandChange={onCanvasAutoExpandChange}
        uiScale={uiScale}
        onUIScaleChange={onUIScaleChange}
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

/** Streaming text projection — shows the latest assistant message. */
function ProjectionText({ messages }: { messages: import("../hooks/useChat").ChatMessage[] }) {
  let text = "Toca al avatar o escribe algo para empezar.";
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
    if (isStreaming || !text) return null;
    try {
      return marked.parse(text, { async: false }) as string;
    } catch {
      return `<p>${text}</p>`;
    }
  }, [text, isStreaming]);

  if (!text) {
    return (
      <p className="text-center text-muted/60 transition-opacity duration-300" style={{ fontFamily: "Fraunces, serif", fontSize: "calc(1.2rem * var(--mul-text))", lineHeight: 1.5 }}>
        Toca al avatar o escribe algo para empezar.
      </p>
    );
  }

  if (isStreaming) {
    return (
      <p className="text-center text-fg transition-opacity duration-300" style={{ fontFamily: "Fraunces, serif", fontSize: "calc(1.6rem * var(--mul-text))", lineHeight: 1.5, fontVariationSettings: '"SOFT" 60' }}>
        {text}
        <span className="inline-block w-0.5 h-em bg-accent ml-0.5" style={{ animation: "blink 1.1s steps(2,start) infinite" }} />
      </p>
    );
  }

  return (
    <div
      className="prose-md text-left max-h-48 overflow-y-auto scrollbar-thin"
      dangerouslySetInnerHTML={{ __html: html || `<p>${text}</p>` }}
    />
  );
}