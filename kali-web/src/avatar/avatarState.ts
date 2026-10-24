/**
 * avatar/avatarState.ts — Fallback activity tracker for a core that predates the avatar brain.
 *
 * Current cores publish `presence_state` frames (kali-core/presence_engine.py) and every view just
 * renders them. This tracker only derives a coarse equivalent (activity + success/error emotion)
 * from the raw presence event stream, with no React or DOM dependency, so a new client keeps
 * working against an old core.
 */

import type { ActivityId, EmotionId } from "./avatarCatalog.gen";
import type { PresenceFrame } from "./rig/types";

export interface PresenceEvent {
  event: string;
  [key: string]: unknown;
}

export interface AvatarViewState {
  activity: ActivityId;
  emotion: EmotionId;
  text: string;
  connected: boolean;
}

const TEXT_TAIL = 160;
const WAKE_LISTEN_MS = 8000;
/** Speech time assumed for a TTS segment whose duration is unknown (0 / missing). */
const UNKNOWN_SPEECH_S = 1.5;
const ERROR_MS = 3000;

export class AvatarStateTracker {
  private connected = false;
  private streaming = false;
  private text = "";
  private speakingUntil = 0;
  private listeningUntil = 0;
  private toolsRunning = new Set<string>();
  private consentOpen = false;
  private emotion: EmotionId = "neutral";
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
          if (ev.status === "error" || ev.status === "err") this.setEmotion("preocupado", now + ERROR_MS);
        }
        break;
      }
      case "emotion_event":
        if (typeof ev.id === "string") this.setEmotion(ev.id as EmotionId, now + ERROR_MS * 2);
        break;
      case "error":
        this.streaming = false;
        this.setEmotion("preocupado", now + ERROR_MS);
        break;
    }
    return this.view(now);
  }

  /** Re-evaluate time-based transitions (speaking/listening/emotion expiry). */
  view(now = Date.now()): AvatarViewState {
    let activity: ActivityId = "reposo";
    if (this.consentOpen) activity = "esperando";
    else if (now < this.listeningUntil) activity = "escuchando";
    else if (now < this.speakingUntil) activity = "hablando";
    else if (this.toolsRunning.size > 0) activity = "trabajando";
    else if (this.streaming) activity = "pensando";
    const emotion = now < this.emotionUntil ? this.emotion : "neutral";
    return { activity, emotion, text: this.text, connected: this.connected };
  }

  /** Earliest future timestamp at which `view()` may change by itself, or 0. */
  nextDeadline(now = Date.now()): number {
    const times = [this.speakingUntil, this.listeningUntil, this.emotionUntil].filter((t) => t > now);
    return times.length ? Math.min(...times) : 0;
  }

  private setEmotion(emotion: EmotionId, until: number): void {
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

/** A frame equivalent to what the core would publish, for the fallback path. */
export function viewToFrame(view: AvatarViewState, now: number): PresenceFrame {
  const attention = { esperando: "user", escuchando: "user", hablando: "user", trabajando: "work", pensando: "thought" } as Partial<Record<ActivityId, PresenceFrame["attention"]>>;
  return {
    event: "presence_state", v: 2, session_id: "", seq: 0, t: now, connected: view.connected,
    activity: { id: view.activity, since: now },
    emotion: { id: view.emotion, intensity: view.emotion === "neutral" ? 0 : 0.6, since: now, until: view.emotion === "neutral" ? 0 : now + 60_000, source: "system" },
    gesture: null,
    speech: view.activity === "hablando" ? { active: true, segment: 0, started_at: now, duration: 1500, env_hz: 20, env: "", estimated: true } : null,
    attention: attention[view.activity] ?? "cursor",
  };
}
