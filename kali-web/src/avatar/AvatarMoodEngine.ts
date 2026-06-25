/**
 * avatar/AvatarMoodEngine.ts — Derives avatar state + emotion from runtime context.
 *
 * Replaces the old `useAvatarMood` hook with a richer system:
 *   - **State** (idle/escuchando/pensando/hablando) — priority-ordered, same as before.
 *   - **Emotion** (normal/enojado/sorprendido/ronroneando/feliz/confundido) — contextual,
 *     derived from text analysis, tool events, consent, and click interactions.
 *
 * The emotion is only applied when the base state is `idle` or `hablando`;
 * `pensando` and `escuchando` always use `normal` emotion.
 */

import { useMemo, useEffect, useRef, useState } from "react";
import type { AvatarState, AvatarEmotion } from "./avatarConfig";
import { analyzeAssistantText, analyzeUserText } from "./textEmotionAnalyzer";
import { useStage } from "../stage/StageProvider";
import type { ChatMessage } from "../hooks/useChat";
import { getDebugAvatarState, subscribeDebugAvatarState } from "./debugAvatarState";

export interface MoodResult {
  state: AvatarState;
  emotion: AvatarEmotion;
}

/** Temporary emotion override (e.g. from clicking the avatar). */
interface EmotionOverride {
  emotion: AvatarEmotion;
  until: number; // timestamp ms
}

/**
 * Derive the avatar state + emotion from the Stage context.
 *
 * @param typing Whether the user is currently typing in the spotlight.
 * @param overrideEmotion Optional emotion override (e.g. "ronroneando" after click).
 * @returns { state, emotion } — fed to AvatarSVG as data-state / data-mood.
 */
export function useAvatarMoodEngine(
  typing: boolean,
  overrideEmotion?: EmotionOverride | null,
): MoodResult {
  const { chat, tts, ptt } = useStage();
  const [emotion, setEmotion] = useState<AvatarEmotion>("normal");
  const emotionTimer = useRef<number | null>(null);
  const [debugOverride, setDebugOverride] = useState(getDebugAvatarState());

  useEffect(() => {
    return subscribeDebugAvatarState(setDebugOverride);
  }, []);

  // Last assistant/user text for contextual analysis
  const lastAssistantText = useMemo(() => {
    const msgs = chat.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i].content) return msgs[i].content;
    }
    return "";
  }, [chat.messages]);

  const lastUserText = useMemo(() => {
    const msgs = chat.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user" && msgs[i].content) return msgs[i].content;
    }
    return "";
  }, [chat.messages]);

  // Derive base state (priority order, highest first)
  const state = useMemo<AvatarState>(() => {
    if (debugOverride.overrideState) return debugOverride.overrideState;
    if (chat.consentRequest) return "idle"; // → judge stare
    if (chat.toolEvents.some((e) => e.status === "running")) return "idle"; // → judge stare
    if (tts.playing) return "hablando";
    if (ptt.state === "recording" || ptt.state === "listening") return "escuchando";
    if (chat.messages.some((m: ChatMessage) => m.streaming)) return "pensando";
    return "idle";
  }, [debugOverride.overrideState, chat.consentRequest, chat.toolEvents, tts.playing, ptt.state, chat.messages]);

  // Derive contextual emotion
  useEffect(() => {
    // Override takes priority (e.g. click → ronroneando)
    if (overrideEmotion && Date.now() < overrideEmotion.until) {
      setEmotion(overrideEmotion.emotion);
      return;
    }

    // Debug state override takes priority
    if (debugOverride.overrideEmotion) {
      setEmotion(debugOverride.overrideEmotion);
      return;
    }

    // States with fixed emotion
    if (state === "pensando" || state === "escuchando") {
      setEmotion("normal");
      return;
    }

    // Consent / tool running → judge stare (enojado)
    if (chat.consentRequest || chat.toolEvents.some((e) => e.status === "running")) {
      setEmotion("enojado");
      return;
    }

    // Tool just succeeded → happy briefly
    const lastTool = chat.toolEvents[chat.toolEvents.length - 1];
    if (lastTool && lastTool.status === "success") {
      setEmotion("feliz");
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
      emotionTimer.current = window.setTimeout(() => setEmotion("normal"), 2000);
      return;
    }

    // Tool just errored → angry briefly
    if (lastTool && lastTool.status === "error") {
      setEmotion("enojado");
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
      emotionTimer.current = window.setTimeout(() => setEmotion("normal"), 3000);
      return;
    }

    // Chat error → angry briefly
    if (chat.error) {
      setEmotion("enojado");
      if (emotionTimer.current) clearTimeout(emotionTimer.current);
      emotionTimer.current = window.setTimeout(() => setEmotion("normal"), 3000);
      return;
    }

    // User typing → attentive (sorprendido)
    if (typing) {
      setEmotion("sorprendido");
      return;
    }

    // Analyze last assistant text for contextual emotion
    if (state === "idle" && lastAssistantText) {
      const match = analyzeAssistantText(lastAssistantText);
      if (match.confidence > 0.6 && match.emotion !== "normal") {
        setEmotion(match.emotion);
        if (emotionTimer.current) clearTimeout(emotionTimer.current);
        emotionTimer.current = window.setTimeout(() => setEmotion("normal"), 3000);
        return;
      }
    }

    // Analyze last user text (frustration → confused)
    if (state === "idle" && lastUserText) {
      const match = analyzeUserText(lastUserText);
      if (match.confidence > 0.6 && match.emotion !== "normal") {
        setEmotion(match.emotion);
        if (emotionTimer.current) clearTimeout(emotionTimer.current);
        emotionTimer.current = window.setTimeout(() => setEmotion("normal"), 3000);
        return;
      }
    }

    // No messages → normal (sleep is handled by CSS timeout)
    setEmotion("normal");
  }, [state, overrideEmotion, debugOverride, chat.consentRequest, chat.toolEvents, chat.error, typing, lastAssistantText, lastUserText]);

  return { state, emotion };
}