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
  const wasTtsPlaying = useRef(false);

  const emotionProvider = useMemo(() =>
    getEmotionProviderSetting() === "local"
      ? new LocalModelEmotionProvider()
      : new LLMEmotionProvider(),
    [],
  );

  useEffect(() => {
    return subscribeDebugAvatarState(setDebugOverride);
  }, []);

  const streaming = useMemo(() => {
    return chat.messages.some((m: ChatMessage) => m.streaming);
  }, [chat.messages]);

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

  useEffect(() => {
    const lastTool = chat.toolEvents[chat.toolEvents.length - 1];
    if (lastTool && (lastTool.status === "success" || lastTool.status === "error")) {
      const ms = lastTool.status === "success" ? EMOTION_CONFIG.successEmotionMs : EMOTION_CONFIG.errorEmotionMs;
      if (decayTimer.current) clearTimeout(decayTimer.current);
      decayTimer.current = window.setTimeout(() => {
        setCurrentMood("normal");
        decayTimer.current = null;
      }, ms);
    }

    return () => {
      if (decayTimer.current) {
        clearTimeout(decayTimer.current);
        decayTimer.current = null;
      }
    };
  }, [chat.toolEvents]);

  useEffect(() => {
    if (chat.ttsPlaying === wasTtsPlaying.current) return;
    wasTtsPlaying.current = chat.ttsPlaying;

    if (chat.ttsPlaying) {
      if (decayTimer.current) {
        clearTimeout(decayTimer.current);
        decayTimer.current = null;
      }
    } else {
      const lifetime = EMOTION_CONFIG.emotionDecayMs[currentMood];
      if (lifetime && currentMood !== "normal") {
        if (decayTimer.current) clearTimeout(decayTimer.current);
        decayTimer.current = window.setTimeout(() => {
          setCurrentMood("normal");
          decayTimer.current = null;
        }, lifetime);
      }
    }
  }, [chat.ttsPlaying, currentMood]);

  useEffect(() => {
    if (currentMood === "normal" || chat.ttsPlaying) return;
    const lifetime = EMOTION_CONFIG.emotionDecayMs[currentMood];
    if (!lifetime) return;
    if (decayTimer.current) clearTimeout(decayTimer.current);
    decayTimer.current = window.setTimeout(() => {
      setCurrentMood("normal");
      decayTimer.current = null;
    }, lifetime);

    return () => {
      if (decayTimer.current) {
        clearTimeout(decayTimer.current);
        decayTimer.current = null;
      }
    };
  }, [currentMood, chat.ttsPlaying]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (state === "idle" && !chat.ttsPlaying && !streaming) {
        setTick((t) => t + 1);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [state, chat.ttsPlaying, streaming]);

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