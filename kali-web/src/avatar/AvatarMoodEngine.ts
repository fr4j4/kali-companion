/**
 * avatar/AvatarMoodEngine.ts — Derives avatar state + emotion from runtime context.
 *
 * Replaces the old `useAvatarMood` hook with a richer system:
 *   - **State** (idle/escuchando/pensando/hablando) — priority-ordered.
 *   - **Emotion** (normal/enojado/sorprendido/ronroneando/feliz/confundido/concentrado/esperando)
 *     — contextual, derived from the EmotionProvider (LLM or local model).
 *
 * The emotion engine persists the LLM-provided mood between turns and applies
 * correct precedence: override > debug > tool running > consent > tool error >
 * LLM emotion > fallback to currentMood.
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
  const emotionTimer = useRef<number | null>(null);
  const staleTimer = useRef<number | null>(null);
  const [debugOverride, setDebugOverride] = useState(getDebugAvatarState());

  const emotionProvider = useMemo(() =>
    getEmotionProviderSetting() === "local"
      ? new LocalModelEmotionProvider()
      : new LLMEmotionProvider(),
    [],
  );
  const [staleToolKey, setStaleToolKey] = useState<string | null>(null);

  useEffect(() => {
    return subscribeDebugAvatarState(setDebugOverride);
  }, []);

  const streaming = useMemo(() => {
    return chat.messages.some((m: ChatMessage) => m.streaming);
  }, [chat.messages]);

  const avatarCtx = useMemo((): AvatarContext => ({
    emotionEvents: chat.emotionEvents,
    toolEvents: chat.toolEvents,
    chatError: chat.error,
    now: Date.now(),
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
  }), [chat.emotionEvents, chat.toolEvents, chat.error, chat.consentRequest, chat.ttsPlaying, ptt.state, streaming, typing, overrideEmotion, currentMood, debugOverride, staleToolKey]);

  const state = useMemo(() => deriveState(avatarCtx), [avatarCtx]);

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
    const hasRunning = chat.toolEvents.some((e) => e.status === "running");

    if (hasRunning && state === "idle") {
      if (staleTimer.current) clearTimeout(staleTimer.current);
      staleTimer.current = window.setTimeout(() => {
        const runningTool = chat.toolEvents.find((e) => e.status === "running");
        if (runningTool) {
          setStaleToolKey(`${runningTool.session_id}::${runningTool.tool}`);
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
    if (!lastTool) return;

    if (lastTool.status === "success") {
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
      emotionTimer.current = window.setTimeout(() => {
        setCurrentMood("normal");
      }, EMOTION_CONFIG.successEmotionMs);
    } else if (lastTool.status === "error") {
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
      emotionTimer.current = window.setTimeout(() => {
        setCurrentMood("normal");
      }, EMOTION_CONFIG.errorEmotionMs);
    }

    return () => {
      if (emotionTimer.current) {
        clearTimeout(emotionTimer.current);
        emotionTimer.current = null;
      }
    };
  }, [chat.toolEvents]);

  useEffect(() => {
    return () => {
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
      if (staleTimer.current) clearTimeout(staleTimer.current);
    };
  }, []);

  const emotion = currentMood;

  return { state, emotion };
}
