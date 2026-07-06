/**
 * avatar/AvatarMoodEngine.ts — Derives avatar state + emotion from runtime context.
 *
 * State (idle/escuchando/pensando/hablando/durmiendo) is priority-ordered.
 * Emotion (normal/enojado/sorprendido/ronroneando/feliz/confundido/concentrado/esperando)
 * is contextual, derived from the EmotionProvider (LLM or local model).
 *
 * Naturalidad:
 *   - Decay: cada emoción del LLM decae a `normal` tras un lifetime configurable.
 *     El decay se pausa durante TTS (el avatar habla con su emoción) y se resetea
 *     al terminar el TTS con el lifetime completo.
 *   - Inactividad: tras `sleepMs` sin actividad Y currentMood === "normal", el
 *     avatar duerme. Si currentMood no es normal, mantiene la emoción visualmente
 *     hasta que decae.
 *   - Micro-variaciones: en idle + normal, ocasionalmente muestra una micro-emoción
 *     breve (sorprendido/confundido/feliz) para verse vivo.
 */

import { useMemo, useEffect, useRef, useState } from "react";
import type { AvatarState, AvatarEmotion } from "./avatarConfig";
import { useStage } from "../stage/StageProvider";
import type { ChatMessage } from "../hooks/useChat";
import { getDebugAvatarState, subscribeDebugAvatarState } from "./debugAvatarState";
import { deriveState, deriveEmotion, type AvatarContext } from "./avatarStateMachine";
import { LLMEmotionProvider } from "./LLMEmotionProvider";
import { LocalModelEmotionProvider } from "./LocalModelEmotionProvider";
import { getEmotionProviderSetting } from "./EmotionSettings";
import { EMOTION_CONFIG } from "./emotionConfig";

export interface MoodResult {
  state: AvatarState;
  emotion: AvatarEmotion;
  relaxed: boolean;
}

interface EmotionOverride {
  emotion: AvatarEmotion;
  until: number;
}

/** Status of the most recent tool event, or undefined if none. */
export type ToolStatus = "running" | "success" | "error" | "cancelled" | undefined;

/**
 * Pure helper: decide how long the current emotion should last before decaying
 * to "normal". Returns the duration in ms, or undefined if no decay timer should
 * be scheduled.
 *
 * Rules (evaluated in order):
 * 1. normal mood → no decay (undefined).
 * 2. TTS playing → pause decay (undefined); the unified effect re-schedules
 *    when TTS stops.
 * 3. Recent tool success/error → use the short tool lifetime so the tool
 *    result's emotion fades quickly, overriding the LLM emotion's lifetime.
 * 4. Otherwise → use the per-emotion lifetime from EMOTION_CONFIG.emotionDecayMs.
 *    Emotions without a configured lifetime (concentrado, esperando, normal)
 *    return undefined — they are programmatic and clear via context, not timers.
 */
export function resolveDecayMs(
  currentMood: AvatarEmotion,
  lastToolStatus: ToolStatus,
  ttsPlaying: boolean,
  config: {
    successEmotionMs: number;
    errorEmotionMs: number;
    emotionDecayMs: Partial<Record<AvatarEmotion, number>>;
  },
): number | undefined {
  if (currentMood === "normal") return undefined;
  if (ttsPlaying) return undefined;
  if (lastToolStatus === "success") return config.successEmotionMs;
  if (lastToolStatus === "error") return config.errorEmotionMs;
  return config.emotionDecayMs[currentMood];
}

export function useAvatarMoodEngine(
  typing: boolean,
  overrideEmotion?: EmotionOverride | null,
): MoodResult {
  const { chat, ptt } = useStage();
  const [currentMood, setCurrentMood] = useState<AvatarEmotion>("normal");
  const [staleToolKey, setStaleToolKey] = useState<string | null>(null);
  const [debugOverride, setDebugOverride] = useState(getDebugAvatarState());
  const [, setTick] = useState(0);

  const decayTimer = useRef<number | null>(null);
  const staleTimer = useRef<number | null>(null);
  const microCheckRef = useRef<number | null>(null);
  const microTimer = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const prevSessionRef = useRef<string | null>(chat.sessionId);

  const emotionProvider = useMemo(() =>
    getEmotionProviderSetting() === "local"
      ? new LocalModelEmotionProvider()
      : new LLMEmotionProvider(),
    [],
  );

  useEffect(() => {
    return subscribeDebugAvatarState(setDebugOverride);
  }, []);

  // Reset avatar state when the chat session changes (new session or attach).
  useEffect(() => {
    if (chat.sessionId === prevSessionRef.current) return;
    prevSessionRef.current = chat.sessionId;
    setCurrentMood("normal");
    setStaleToolKey(null);
    if (decayTimer.current) { clearTimeout(decayTimer.current); decayTimer.current = null; }
    if (staleTimer.current) { clearTimeout(staleTimer.current); staleTimer.current = null; }
    if (microCheckRef.current) { clearTimeout(microCheckRef.current); microCheckRef.current = null; }
    if (microTimer.current) { clearTimeout(microTimer.current); microTimer.current = null; }
    lastActivityRef.current = Date.now();
  }, [chat.sessionId]);

  const rawStreaming = useMemo(() => {
    return chat.messages.some((m: ChatMessage) => m.streaming);
  }, [chat.messages]);

  // Safety timeout: if streaming is true but no activity for a long time
  // (turn_end was lost, TTS failed, WS disconnected), treat as not streaming
  // so the avatar doesn't get stuck in "pensando" forever.
  const streaming = rawStreaming && (Date.now() - lastActivityRef.current < EMOTION_CONFIG.streamingTimeoutMs);

  const lastAssistantText = useMemo(() => {
    const msgs = chat.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i].content) return msgs[i].content;
    }
    return "";
  }, [chat.messages]);

  const hasLiveTool = chat.toolEvents.some((e) => e.status === "running" && `${e.session_id}::${e.tool}` !== staleToolKey);
  const isActivity = chat.messages.length > 0 || chat.ttsPlaying || ptt.state !== "idle"
    || typing || hasLiveTool || overrideEmotion != null || streaming;
  if (isActivity) lastActivityRef.current = Date.now();

  const avatarCtx = useMemo((): AvatarContext => ({
    emotionEvents: chat.emotionEvents,
    toolEvents: chat.toolEvents,
    chatError: chat.error,
    now: Date.now(),
    lastAssistantText,
    debug: debugOverride,
    consentRequest: chat.consentRequest,
    ttsPlaying: chat.ttsPlaying,
    pttState: ptt.state,
    streaming,
    typing,
    overrideEmotion,
    currentMood,
    emotionProvider,
    staleToolKey,
    lastActivityTs: lastActivityRef.current,
    sleepMs: EMOTION_CONFIG.sleepMs,
  }), [chat.emotionEvents, chat.toolEvents, chat.error, chat.consentRequest, chat.ttsPlaying, ptt.state, streaming, typing, overrideEmotion, currentMood, debugOverride, staleToolKey, lastAssistantText]);

  const rawState = useMemo(() => deriveState(avatarCtx), [avatarCtx]);
  const state: AvatarState = rawState === "durmiendo" && currentMood !== "normal" ? "idle" : rawState;

  useEffect(() => {
    let cancelled = false;

    async function updateEmotion() {
      const emotion = await deriveEmotion(avatarCtx, state);
      if (cancelled) return;
      setCurrentMood((prev) => {
        if (emotion !== prev) return emotion;
        return prev;
      });
    }

    updateEmotion();

    return () => {
      cancelled = true;
    };
  }, [avatarCtx, state]);

  useEffect(() => {
    const runningTool = chat.toolEvents.find((e) => e.status === "running");
    if (runningTool && state === "idle") {
      if (staleTimer.current) clearTimeout(staleTimer.current);
      staleTimer.current = window.setTimeout(() => {
        const stillRunning = chat.toolEvents.find((e) => e.status === "running");
        if (stillRunning) {
          setStaleToolKey(`${stillRunning.session_id}::${stillRunning.tool}`);
        }
      }, EMOTION_CONFIG.toolStaleMs);
    } else {
      if (staleTimer.current) {
        clearTimeout(staleTimer.current);
        staleTimer.current = null;
      }
      setStaleToolKey(null);
    }

    return () => {
      if (staleTimer.current) {
        clearTimeout(staleTimer.current);
        staleTimer.current = null;
      }
    };
  }, [chat.toolEvents, state]);

  // Unified decay timer — single source of truth.
  // Decides the duration via resolveDecayMs and manages one timer.
  // Replaces the three competing effects that previously overwrote each other.
  useEffect(() => {
    if (currentMood === "normal" || chat.ttsPlaying) {
      if (decayTimer.current) { clearTimeout(decayTimer.current); decayTimer.current = null; }
      return;
    }

    const lastTool = chat.toolEvents[chat.toolEvents.length - 1];
    const lastToolStatus = lastTool?.status as ToolStatus;

    const ms = resolveDecayMs(currentMood, lastToolStatus, chat.ttsPlaying, EMOTION_CONFIG);
    if (!ms) {
      if (decayTimer.current) { clearTimeout(decayTimer.current); decayTimer.current = null; }
      return;
    }

    if (decayTimer.current) clearTimeout(decayTimer.current);
    decayTimer.current = window.setTimeout(() => {
      setCurrentMood("normal");
      decayTimer.current = null;
    }, ms);

    return () => {
      if (decayTimer.current) { clearTimeout(decayTimer.current); decayTimer.current = null; }
    };
  }, [currentMood, chat.ttsPlaying, chat.toolEvents]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Tick when idle (for sleep detection) OR when rawStreaming is stuck
      // (for the streaming safety timeout to fire).
      if (state === "idle" || rawStreaming) {
        setTick((t) => t + 1);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [state, rawStreaming]);

  useEffect(() => {
    const isIdleNormal = state === "idle" && currentMood === "normal"
      && !chat.ttsPlaying && !streaming && !typing
      && !chat.toolEvents.some((e) => e.status === "running");

    if (!isIdleNormal) {
      if (microCheckRef.current) { clearTimeout(microCheckRef.current); microCheckRef.current = null; }
      if (microTimer.current) { clearTimeout(microTimer.current); microTimer.current = null; }
      return;
    }

    const variations = EMOTION_CONFIG.microVariationProbabilities;
    const scheduleNext = () => {
      microCheckRef.current = window.setTimeout(() => {
        for (const [emotion, cfg] of Object.entries(variations)) {
          if (Math.random() < cfg.chance) {
            setCurrentMood(emotion as AvatarEmotion);
            microTimer.current = window.setTimeout(() => {
              setCurrentMood("normal");
              microTimer.current = null;
            }, cfg.durationMs);
            scheduleNext();
            return;
          }
        }
        scheduleNext();
      }, EMOTION_CONFIG.microVariationIntervalMs);
    };

    scheduleNext();

    return () => {
      if (microCheckRef.current) { clearTimeout(microCheckRef.current); microCheckRef.current = null; }
      if (microTimer.current) { clearTimeout(microTimer.current); microTimer.current = null; }
    };
  }, [state, currentMood, chat.ttsPlaying, streaming, typing, chat.toolEvents]);

  useEffect(() => {
    return () => {
      if (decayTimer.current) clearTimeout(decayTimer.current);
      if (staleTimer.current) clearTimeout(staleTimer.current);
      if (microCheckRef.current) clearTimeout(microCheckRef.current);
      if (microTimer.current) clearTimeout(microTimer.current);
    };
  }, []);

  const idleTime = Date.now() - lastActivityRef.current;
  const relaxed = state === "idle" && currentMood === "normal"
    && idleTime > EMOTION_CONFIG.idleRelaxedMs && idleTime <= EMOTION_CONFIG.sleepMs;

  return { state, emotion: currentMood, relaxed };
}