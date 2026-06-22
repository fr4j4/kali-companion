import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useChat, getSidecarPort } from "./hooks/useChat";
import { useTTS } from "./hooks/useTTS";
import { usePTT } from "./hooks/usePTT";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { Header } from "./components/Header";
import { ChatPanel } from "./components/ChatPanel";
import { InputBar } from "./components/InputBar";
import { AudioVisualizer } from "./components/AudioVisualizer";
import { SettingsModal } from "./components/SettingsModal";
import { ConsentModal } from "./components/ConsentModal";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { Sheet } from "./components/ui/Sheet";
import { JobsPanel } from "./components/JobsPanel";

export default function App() {
  const { i18n } = useTranslation();
  const { isMobile } = useBreakpoint();
  const chat = useChat();
  const tts = useTTS(chat.subscribeTts, chat.onTtsEnded);
  const navigate = useNavigate();
  const { sid: urlSid } = useParams<{ sid?: string }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("kali.theme") ?? "midnight",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("kali.sidebarCollapsed") === "true",
  );
  const [canvasCollapsed, setCanvasCollapsed] = useState(
    () => localStorage.getItem("kali.canvasCollapsed") !== "false",
  );
  const [canvasAutoExpand, setCanvasAutoExpand] = useState(
    () => localStorage.getItem("kali.canvasAutoExpand") !== "false",
  );
  const [mobilePanel, setMobilePanel] = useState<"none" | "sidebar" | "canvas">("none");
  const [jobsOpen, setJobsOpen] = useState(false);

  const runningJobs = Array.from(chat.jobs.values()).filter((j) => j.status === "running").length;

  // URL → state: when the URL session ID changes, attach to it.
  // Skip if the URL has no sid (root path) — the backend will assign a new session.
  const lastAttachedRef = useRef<string | null>(null);
  useEffect(() => {
    if (urlSid && chat.status === "ready" && urlSid !== chat.sessionId && urlSid !== lastAttachedRef.current) {
      lastAttachedRef.current = urlSid;
      chat.attachSession(urlSid);
    }
  }, [urlSid, chat.status, chat.sessionId, chat.attachSession]);

  // State → URL: when the session ID changes from a new session (ready/connected),
  // sync it into the URL so it's bookmarkable and survives reload.
  // Only do this when we're on the root path (no urlSid) to avoid clobbering
  // a URL the user is trying to attach to.
  useEffect(() => {
    if (chat.sessionId && !urlSid) {
      navigate(`/session/${chat.sessionId}`, { replace: true });
    }
  }, [chat.sessionId, urlSid, navigate]);

  useEffect(() => {
    if (chat.artifacts.size > 0 && canvasAutoExpand) {
      if (isMobile) {
        setMobilePanel("canvas");
      } else {
        setCanvasCollapsed(false);
      }
    }
  }, [chat.artifacts.size, canvasAutoExpand, isMobile]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobilePanel((prev) => (prev === "sidebar" ? "none" : "sidebar"));
    } else {
      setSidebarCollapsed((prev) => {
        const next = !prev;
        localStorage.setItem("kali.sidebarCollapsed", String(next));
        return next;
      });
    }
  }, [isMobile]);

  const toggleCanvas = useCallback(() => {
    if (isMobile) {
      setMobilePanel((prev) => (prev === "canvas" ? "none" : "canvas"));
    } else {
      setCanvasCollapsed((prev) => {
        const next = !prev;
        localStorage.setItem("kali.canvasCollapsed", String(next));
        return next;
      });
    }
  }, [isMobile]);

  const wsClientRef = chat.wsClient;
  const onWakeWord = useCallback(() => {
    if (tts.playing) {
      tts.stop();
      chat.stop();
    }
  }, [tts.playing, tts.stop, chat.stop]);
  const ptt = usePTT({
    client: wsClientRef,
    wakeWordEnabled: chat.systemStatus?.wake_word_enabled ?? false,
    inputMode: chat.systemStatus?.input_mode as "ptt" | "wake_word" | "continuous" | undefined,
    onWakeWord,
  });

  const _STRIP_WW = /\b(kali|cali)[\s,.;!?]*/gi;
  const prevFinalRef = useRef("");
  useEffect(() => {
    if (ptt.finalText && ptt.finalText !== prevFinalRef.current) {
      prevFinalRef.current = ptt.finalText;
      const cleaned = ptt.finalText.replace(_STRIP_WW, "").trim();
      if (cleaned) chat.send(cleaned);
    }
  }, [ptt.finalText, chat]);

  useEffect(() => {
    async function fetchVoices() {
      try {
        const port = await getSidecarPort();
        const host = window.location.hostname;
        const resp = await fetch(`http://${host}:${port ?? 8900}/voices`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.voices && Array.isArray(data.voices)) {
            setVoices(
              data.voices.map((v: { voice_id: string; name: string }) => ({
                id: v.voice_id,
                name: v.name,
              })),
            );
          }
        }
      } catch {
        // keep default empty
      }
    }
    void fetchVoices();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kali.theme", theme);
  }, [theme]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      if (bg) meta.setAttribute("content", bg);
    }
  }, [theme]);

  const isStreaming = chat.messages.some((m) => m.streaming);

  return (
    <div className="h-full flex flex-col bg-surface text-foreground">
      <Header
        status={chat.status}
        systemStatus={chat.systemStatus}
        onNewSession={() => {
          lastAttachedRef.current = null;
          navigate("/");
          chat.newSession();
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onLanguageChange={(lang) => {
          void i18n.changeLanguage(lang);
          localStorage.setItem("kali.lang", lang);
        }}
        currentLanguage={i18n.language}
        wakeWordActive={ptt.wakeWordActive}
        sidebarCollapsed={isMobile ? mobilePanel !== "sidebar" : sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        canvasCollapsed={isMobile ? mobilePanel !== "canvas" : canvasCollapsed}
        onToggleCanvas={toggleCanvas}
        onOpenJobs={() => {
          chat.listJobs();
          setJobsOpen(true);
        }}
        jobsActive={runningJobs}
      />

      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 flex overflow-hidden">
          {!isMobile && (
            <Sidebar
              sessions={chat.sessions}
              activeSessionId={chat.sessionId}
              onNewSession={() => {
                lastAttachedRef.current = null;
                navigate("/");
                chat.newSession();
              }}
              collapsed={sidebarCollapsed}
              onToggle={toggleSidebar}
            />
          )}

          <div className="flex-1 flex flex-col min-w-0">
            <ChatPanel
              messages={chat.messages}
              imageReadyKeys={chat.imageReadyKeys}
              onRequestImage={chat.requestImage}
            />
          </div>

          {!isMobile && (
            <Canvas
              artifacts={chat.artifacts}
              collapsed={canvasCollapsed}
              onToggle={toggleCanvas}
              imageReadyKeys={chat.imageReadyKeys}
              onRequestImage={chat.requestImage}
            />
          )}
        </div>
      </main>

      <footer className="border-t border-border bg-elevated px-3 py-2 max-lg:pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between min-h-[32px] px-1 pb-1">
          <div className="flex items-center gap-2">
            {chat.ttsFilteredRaw > 0 && (
              <span className="text-xs text-muted">
                TTS {chat.ttsFilteredRaw}→{chat.ttsFilteredOut} chars
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {tts.playing && (
              <button
                className="bg-transparent border border-err text-err rounded-md w-7 h-7 text-sm cursor-pointer flex items-center justify-center p-0 leading-none hover:bg-err/15"
                onClick={tts.stop}
                title="Mute TTS"
                aria-label="Mute TTS"
              >
                🔇
              </button>
            )}
            <AudioVisualizer analyser={tts.analyser} active={tts.playing} />
          </div>
        </div>
        <InputBar
          onSend={chat.send}
          onStop={() => {
            chat.stop();
            tts.stop();
          }}
          streaming={isStreaming}
          pttState={ptt.state}
          pttPartialText={ptt.partialText}
          onPTTStart={() => void ptt.start()}
          onPTTStop={ptt.stop}
          onPTTCancel={ptt.cancel}
        />
      </footer>

      {chat.error && (
        <div className="fixed bottom-20 lg:bottom-24 left-1/2 -translate-x-1/2 bg-err text-white px-4 py-2 rounded-md text-sm z-50 max-w-[90vw] lg:max-w-md text-center">
          {chat.error}
        </div>
      )}
      {ptt.error && (
        <div className="fixed bottom-20 lg:bottom-24 left-1/2 -translate-x-1/2 bg-err text-white px-4 py-2 rounded-md text-sm z-50 max-w-[90vw] lg:max-w-md text-center">
          {ptt.error}
        </div>
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        systemStatus={chat.systemStatus}
        voices={voices}
        onUpdate={chat.updateSettings}
        theme={theme}
        onThemeChange={setTheme}
        canvasAutoExpand={canvasAutoExpand}
        onCanvasAutoExpandChange={(v: boolean) => {
          setCanvasAutoExpand(v);
          localStorage.setItem("kali.canvasAutoExpand", String(v));
        }}
      />

      <ConsentModal
        request={chat.consentRequest}
        onRespond={chat.respondConsent}
      />

      <JobsPanel
        open={jobsOpen}
        onClose={() => setJobsOpen(false)}
        jobs={chat.jobs}
        onCancelJob={chat.cancelJob}
        onGetLogs={chat.getJobLogs}
      />

      {isMobile && (
        <Sheet side="left" open={mobilePanel === "sidebar"} onClose={() => setMobilePanel("none")}>
          <Sidebar
            sessions={chat.sessions}
            activeSessionId={chat.sessionId}
            onNewSession={() => {
              lastAttachedRef.current = null;
              navigate("/");
              chat.newSession();
              setMobilePanel("none");
            }}
            collapsed={false}
            onToggle={() => setMobilePanel("none")}
          />
        </Sheet>
      )}
      {isMobile && (
        <Sheet side="bottom" open={mobilePanel === "canvas"} onClose={() => setMobilePanel("none")} title="Canvas">
          <Canvas
            artifacts={chat.artifacts}
            collapsed={false}
            onToggle={() => setMobilePanel("none")}
            imageReadyKeys={chat.imageReadyKeys}
            onRequestImage={chat.requestImage}
          />
        </Sheet>
      )}
    </div>
  );
}
