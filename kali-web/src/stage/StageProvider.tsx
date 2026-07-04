// StageProvider — wraps the core hooks (useChat, useTTS, usePTT) in a single
// Context so the Stage tree can consume them without prop-drilling.
//
// Also owns the cross-hook orchestration previously inlined in App.tsx:
//   - URL <-> session sync
//   - PTT final transcript -> chat.send
//   - wake-word barge-in (stop TTS + chat)

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChat, getSidecarPort, type ChatState } from "../hooks/useChat";
import { useTTS, type TtsPlaybackState } from "../hooks/useTTS";
import { usePTT, type PTTControls } from "../hooks/usePTT";
import type {
  CloudProviderInfo,
  ConnectionSummary,
  CustomVoice,
} from "../lib/protocol";
import {
  listConnections,
  listCloudProviders,
} from "../lib/api/connections";

interface StageContextValue {
  chat: ChatState;
  tts: TtsPlaybackState & { stop: () => void };
  ptt: PTTControls;
  customVoices: CustomVoice[];
  sttLanguage: string;
  ttsProvider: string;
  ttsModel: string | null;
  ttsLoaded: boolean;
  ttsAvailable: boolean;
  ttsVariant: string | null;
  sttProvider: string;
  connections: ConnectionSummary[];
  activeConnectionId: string | null;
  cloudProviders: CloudProviderInfo[];
  refreshConnections: () => Promise<void>;
  activateConnection: (id: string, model: string) => Promise<void>;
  deactivateConnection: () => void;
  configWarnings: string[];
}

const StageContext = createContext<StageContextValue | null>(null);

// Fetch with exponential-backoff retry. Guards against the core
// sidecar not being ready yet (connection refused surfaces in
// Firefox as a misleading "CORS did not succeed" error).
async function fetchWithRetry(
  url: string,
  opts: { tries?: number; baseDelay?: number } = {},
): Promise<Response | null> {
  const tries = opts.tries ?? 5;
  const baseDelay = opts.baseDelay ?? 400;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const resp = await fetch(url);
      if (resp.ok || resp.status >= 400) return resp; // 4xx/5xx won't fix themselves
      return resp;
    } catch (err) {
      if (attempt === tries) return null;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
    }
  }
  return null;
}

export function StageProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  const tts = useTTS(chat.subscribeTts, chat.onTtsEnded);
  const navigate = useNavigate();
  const { sid: urlSid } = useParams<{ sid?: string }>();
  const [customVoices, setCustomVoices] = useState<CustomVoice[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [cloudProviders, setCloudProviders] = useState<CloudProviderInfo[]>([]);
  const connectionsSigRef = useRef<string>("");

  // Sync the connections list from the live status event (server pushes
  // it after every CRUD).  Falls back to a one-shot fetch on first ready
  // so a fresh page load still shows the persisted list.
  // Only updates when the actual list content changes (avoids re-testing
  // all connections on every unrelated settings change).
  useEffect(() => {
    const live = chat.systemStatus?.connections;
    if (!live || live.length < 0) return;
    const sig = JSON.stringify(live.map((c) => [c.id, c.is_active, c.active_model]));
    if (sig === connectionsSigRef.current) return;
    connectionsSigRef.current = sig;
    setConnections(live);
  }, [chat.systemStatus?.connections]);

  const refreshConnections = useCallback(async () => {
    try {
      const list = await listConnections();
      connectionsSigRef.current = JSON.stringify(list.map((c) => [c.id, c.is_active, c.active_model]));
      setConnections(list);
    } catch {
      // keep stale list
    }
  }, []);

  // One-shot fetch on ready + on custom event (mirrors custom-voices pattern).
  useEffect(() => {
    if (chat.status !== "ready") return;
    void refreshConnections();
    const handler = () => void refreshConnections();
    window.addEventListener("refresh-connections", handler);
    return () => window.removeEventListener("refresh-connections", handler);
  }, [chat.status, refreshConnections]);

  // Cloud providers list (static, fetched once).
  useEffect(() => {
    if (chat.status !== "ready") return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await listCloudProviders();
        if (!cancelled) setCloudProviders(list);
      } catch {
        // keep empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chat.status]);

  const activateConnection = useCallback(
    async (id: string, model: string) => {
      // Reuse the WS event defined in protocol.ts; server validates the id
      // and hot-swaps the live DirectLLMProvider.  A fresh status event
      // follows within milliseconds, updating `connections` via the effect
      // above.
      chat.sendEvent({ event: "activate_connection", id, model });
    },
    [chat],
  );

  const deactivateConnection = useCallback(() => {
    chat.sendEvent({ event: "deactivate_connection" });
  }, [chat]);

  // URL -> state: attach to the session in the URL once ready.
  const lastAttachedRef = useRef<string | null>(null);
  useEffect(() => {
    // While the user explicitly requested a new session, do not re-attach to the
    // previous session URL. The effect below will move the URL to root and then
    // to /session/<newId> once the backend responds.
    if (chat.isCreatingSession) return;
    if (urlSid && chat.status === "ready" && urlSid !== chat.sessionId && urlSid !== lastAttachedRef.current) {
      lastAttachedRef.current = urlSid;
      chat.attachSession(urlSid);
    }
  }, [urlSid, chat.status, chat.sessionId, chat.attachSession, chat.isCreatingSession]);

  // State -> URL: bookmark the active session, or clear URL if no session.
  useEffect(() => {
    if (chat.isCreatingSession && urlSid) {
      // User pressed "new session"; move to the URL root immediately and record
      // the old URL session id so the attach effect above does not pull us back.
      lastAttachedRef.current = urlSid;
      navigate("/", { replace: true });
      return;
    }
    if (chat.sessionId && !urlSid) {
      navigate(`/session/${chat.sessionId}`, { replace: true });
    } else if (!chat.sessionId && urlSid && chat.status === "ready") {
      navigate("/", { replace: true });
    }
    // When the active session is cleared (e.g. new session), forget the last
    // attached id so navigating back to an old session URL can re-attach later.
    if (!chat.sessionId && !chat.isCreatingSession) {
      lastAttachedRef.current = null;
    }
  }, [chat.sessionId, urlSid, chat.status, chat.isCreatingSession, navigate]);

  // Wake-word barge-in: stop TTS + generation.
  const onWakeWord = useCallback(() => {
    if (tts.playing) {
      tts.stop();
      chat.stop();
    }
  }, [tts.playing, tts.stop, chat.stop]);

  const ptt = usePTT({
    client: chat.wsClient,
    sttEnabled: chat.systemStatus?.stt_enabled ?? true,
    wakeWordEnabled: chat.systemStatus?.wake_word_enabled ?? false,
    inputMode: chat.systemStatus?.input_mode as "ptt" | "continuous" | undefined,
    onWakeWord,
    vadSilenceTimeout: chat.systemStatus?.stt_vad_silence_timeout ?? 1.0,
    vadAutoCalibrate: chat.systemStatus?.stt_vad_auto_calibrate ?? true,
    vadRmsThreshold: chat.systemStatus?.stt_vad_rms_threshold ?? 0.015,
    onVadSettingsChange: (patch) => chat.updateSettings(patch),
  });

  // PTT final transcript -> chat.send (strip the wake word).
  const _STRIP_WW = /\b(kali|cali)[\s,.;!?]*/gi;
  const prevFinalRef = useRef("");
  useEffect(() => {
    if (ptt.finalText && ptt.finalText !== prevFinalRef.current) {
      prevFinalRef.current = ptt.finalText;
      if (chat.isTurnActive) return;
      const cleaned = ptt.finalText.replace(_STRIP_WW, "").trim();
      if (cleaned) chat.send(cleaned);
    }
  }, [ptt.finalText, chat]);

  // Custom voices list (one-shot + refresh on event). Also gated on
  // chat.status === "ready" to avoid racing the sidecar boot.
  const sttLanguage = chat.systemStatus?.stt_language ?? "en";
  const ttsProvider = chat.systemStatus?.tts_provider ?? "piper";
  const ttsModel = chat.systemStatus?.tts_model ?? null;
  const ttsLoaded = chat.systemStatus?.tts_loaded ?? false;
  const ttsAvailable = chat.systemStatus?.tts_available ?? true;
  const ttsVariant = chat.systemStatus?.tts_variant ?? null;
  const sttProvider = chat.systemStatus?.stt_provider ?? "vosk";

  useEffect(() => {
    if (chat.status !== "ready") return;
    async function fetchCustomVoices() {
      if (ttsProvider !== "qwen3" || ttsVariant !== "voicedesign") {
        setCustomVoices([]);
        return;
      }
      const port = await getSidecarPort();
      const host = window.location.hostname;
      const resp = await fetchWithRetry(
        `http://${host}:${port ?? 8900}/voices/custom?provider=qwen3`,
      );
      if (!resp) return;
      try {
        const data = await resp.json();
        if (data.voices && Array.isArray(data.voices)) {
          setCustomVoices(data.voices as CustomVoice[]);
        }
      } catch {
        // keep default empty
      }
    }
    void fetchCustomVoices();

    const handler = () => void fetchCustomVoices();
    window.addEventListener("refresh-custom-voices", handler);
    return () => window.removeEventListener("refresh-custom-voices", handler);
  }, [chat.status, ttsProvider, ttsVariant]);

  const activeConnectionId = chat.systemStatus?.llm_connection_id ?? null;
  const configWarnings = chat.systemStatus?.config_warnings ?? [];
  const value = useMemo<StageContextValue>(() => ({
    chat,
    tts,
    ptt,
    customVoices,
    sttLanguage,
    ttsProvider,
    ttsModel,
    ttsLoaded,
    ttsAvailable,
    ttsVariant,
    sttProvider,
    connections,
    activeConnectionId,
    cloudProviders,
    refreshConnections,
    activateConnection,
    deactivateConnection,
    configWarnings,
  }), [
    chat, tts, ptt, customVoices, sttLanguage, ttsProvider, ttsModel,
    ttsLoaded, ttsAvailable, ttsVariant, sttProvider, connections,
    activeConnectionId, cloudProviders, refreshConnections,
    activateConnection, deactivateConnection, configWarnings,
  ]);
  return <StageContext.Provider value={value}>{children}</StageContext.Provider>;
}

export function useStage(): StageContextValue {
  const ctx = useContext(StageContext);
  if (!ctx) throw new Error("useStage must be used within StageProvider");
  return ctx;
}

// Re-export a helper to start a new session. URL navigation is handled
// centrally by StageProvider via chat.isCreatingSession, so callers only need
// to invoke chat.newSession().
export function useNewSessionNav() {
  const { chat } = useStage();
  return useCallback(() => {
    chat.newSession();
  }, [chat]);
}