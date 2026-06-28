// StageProvider — wraps the core hooks (useChat, useTTS, usePTT) in a single
// Context so the Stage tree can consume them without prop-drilling.
//
// Also owns the cross-hook orchestration previously inlined in App.tsx:
//   - URL <-> session sync
//   - PTT final transcript -> chat.send
//   - wake-word barge-in (stop TTS + chat)
//   - voices list fetch

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChat, getSidecarPort, type ChatState } from "../hooks/useChat";
import { useTTS, type TtsPlaybackState } from "../hooks/useTTS";
import { usePTT, type PTTControls } from "../hooks/usePTT";

interface StageContextValue {
  chat: ChatState;
  tts: TtsPlaybackState & { stop: () => void };
  ptt: PTTControls;
  voices: { id: string; name: string }[];
}

const StageContext = createContext<StageContextValue | null>(null);

export function StageProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  const tts = useTTS(chat.subscribeTts, chat.onTtsEnded);
  const navigate = useNavigate();
  const { sid: urlSid } = useParams<{ sid?: string }>();
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);

  // URL -> state: attach to the session in the URL once ready.
  const lastAttachedRef = useRef<string | null>(null);
  useEffect(() => {
    if (urlSid && chat.status === "ready" && urlSid !== chat.sessionId && urlSid !== lastAttachedRef.current) {
      lastAttachedRef.current = urlSid;
      chat.attachSession(urlSid);
    }
  }, [urlSid, chat.status, chat.sessionId, chat.attachSession]);

  // State -> URL: bookmark the active session, or clear URL if no session.
  useEffect(() => {
    if (chat.sessionId && !urlSid) {
      navigate(`/session/${chat.sessionId}`, { replace: true });
    } else if (!chat.sessionId && urlSid && chat.status === "ready") {
      navigate("/", { replace: true });
    }
  }, [chat.sessionId, urlSid, chat.status, navigate]);

  // Wake-word barge-in: stop TTS + generation.
  const onWakeWord = useCallback(() => {
    if (tts.playing) {
      tts.stop();
      chat.stop();
    }
  }, [tts.playing, tts.stop, chat.stop]);

  const ptt = usePTT({
    client: chat.wsClient,
    wakeWordEnabled: chat.systemStatus?.wake_word_enabled ?? false,
    inputMode: chat.systemStatus?.input_mode as "ptt" | "wake_word" | "continuous" | undefined,
    onWakeWord,
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

  // Voices list (one-shot).
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

  const value: StageContextValue = { chat, tts, ptt, voices };
  return <StageContext.Provider value={value}>{children}</StageContext.Provider>;
}

export function useStage(): StageContextValue {
  const ctx = useContext(StageContext);
  if (!ctx) throw new Error("useStage must be used within StageProvider");
  return ctx;
}

// Re-export a way to reset the "last attached" ref when starting a new session
// from the URL root (used by the Stage when creating a new conversation).
export function useNewSessionNav() {
  const navigate = useNavigate();
  const { chat } = useStage();
  return useCallback(() => {
    navigate("/");
    chat.newSession();
  }, [navigate, chat]);
}