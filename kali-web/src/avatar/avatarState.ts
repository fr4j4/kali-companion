/**
 * avatar/avatarState.ts — Pure avatar state derivation from the raw core event stream.
 *
 * The full UI derives the avatar mood from React state (`AvatarMoodEngine`). The
 * native avatar agent has no chat state: it only receives the compact presence
 * events the core mirrors to `mode: "presence"` connections. This tracker applies
 * the same priority rules to that stream, with no React or DOM dependency, so it
 * can run in the minimal avatar bundle and be unit-tested.
 */

import type { AvatarEmotion, AvatarState } from "./avatarConfig";
import { analyzeAssistantText } from "./textEmotionAnalyzer";

export interface PresenceEvent {
  event: string;
  [key: string]: unknown;
}

export interface AvatarViewState {
  mood: AvatarState;
  emotion: AvatarEmotion;
  text: string;
  connected: boolean;
}

const TEXT_TAIL = 160;
const WAKE_LISTEN_MS = 8000;
/** Speech time assumed for a TTS segment whose duration is unknown (0 / missing). */
const UNKNOWN_SPEECH_S = 1.5;
const SUCCESS_MS = 2000;
const ERROR_MS = 3000;
const REACTION_MS = 3000;

export class AvatarStateTracker {
  private connected = false;
  private streaming = false;
  private text = "";
  private speakingUntil = 0;
  private listeningUntil = 0;
  private toolsRunning = new Set<string>();
  private consentOpen = false;
  private emotion: AvatarEmotion = "normal";
  private emotionUntil = 0;

  /** Feed one event; returns the resulting view state. */
  apply(ev: PresenceEvent, now = Date.now()): AvatarViewState {
    switch (ev.event) {
      case "ready":
        this.connected = true;
        this.streaming = ev.turn_active === true;
        break;
      case "disconnected":
        this.connected = false;
        this.reset();
        break;
      case "turn_start":
        this.streaming = true;
        this.text = "";
        this.listeningUntil = 0;
        this.emotion = "normal";
        break;
      case "delta":
        this.streaming = true;
        if (typeof ev.text === "string") this.text = (this.text + ev.text).slice(-TEXT_TAIL);
        break;
      case "reasoning_delta":
        this.streaming = true;
        break;
      case "message":
        if (ev.role === "assistant" && typeof ev.text === "string") this.text = ev.text.slice(-TEXT_TAIL);
        break;
      case "turn_end":
        this.streaming = false;
        this.consentOpen = false;
        this.toolsRunning.clear();
        this.reactToText(now);
        break;
      case "tts_audio": {
        const seconds = typeof ev.duration === "number" && ev.duration > 0 ? ev.duration : UNKNOWN_SPEECH_S;
        this.speakingUntil = Math.max(this.speakingUntil, now) + seconds * 1000;
        break;
      }
      case "wake_word":
      case "stt_partial":
        this.listeningUntil = now + WAKE_LISTEN_MS;
        break;
      case "stt_final":
        this.listeningUntil = 0;
        break;
      case "consent_request":
        this.consentOpen = true;
        break;
      case "tool_event": {
        const id = String(ev.call_id ?? ev.tool ?? "");
        if (ev.status === "running") {
          this.toolsRunning.add(id);
        } else {
          this.toolsRunning.delete(id);
          this.consentOpen = false;
          if (ev.status === "error" || ev.status === "err") this.setEmotion("enojado", now + ERROR_MS);
          else if (ev.status === "ok" || ev.status === "success") this.setEmotion("feliz", now + SUCCESS_MS);
        }
        break;
      }
      case "error":
        this.setEmotion("enojado", now + ERROR_MS);
        break;
    }
    return this.view(now);
  }

  /** Re-evaluate time-based transitions (speaking/listening/emotion expiry). */
  view(now = Date.now()): AvatarViewState {
    let mood: AvatarState = "idle";
    let emotion: AvatarEmotion = "normal";
    const judging = this.consentOpen || this.toolsRunning.size > 0;
    if (judging) {
      emotion = "enojado"; // judge stare, same as the in-app mood engine
    } else if (now < this.speakingUntil) {
      mood = "hablando";
    } else if (now < this.listeningUntil) {
      mood = "escuchando";
    } else if (this.streaming) {
      mood = "pensando";
    }
    if (!judging && mood !== "pensando" && mood !== "escuchando" && now < this.emotionUntil) emotion = this.emotion;
    return { mood, emotion, text: this.text, connected: this.connected };
  }

  /** Earliest future timestamp at which `view()` may change by itself, or 0. */
  nextDeadline(now = Date.now()): number {
    const times = [this.speakingUntil, this.listeningUntil, this.emotionUntil].filter((t) => t > now);
    return times.length ? Math.min(...times) : 0;
  }

  private reactToText(now: number): void {
    const match = analyzeAssistantText(this.text);
    if (match.confidence > 0.6 && match.emotion !== "normal") this.setEmotion(match.emotion, now + REACTION_MS);
  }

  private setEmotion(emotion: AvatarEmotion, until: number): void {
    this.emotion = emotion;
    this.emotionUntil = until;
  }

  private reset(): void {
    this.streaming = false;
    this.speakingUntil = 0;
    this.listeningUntil = 0;
    this.toolsRunning.clear();
    this.consentOpen = false;
    this.emotionUntil = 0;
  }
}
