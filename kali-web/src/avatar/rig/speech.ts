import { speechEnvelope } from "../speechEnvelope";
import type { PresenceFrame } from "./types";

const ATTACK_MS = 40;
const RELEASE_MS = 90;
const GATE = 0.06;

export function decodeEnvelope(b64: string): Uint8Array | null {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Mouth level (0..1) with attack/release smoothing and a noise gate. Sources, by priority:
 * a local audio analyser (canvas), the core's RMS envelope (floating/native), a synthetic syllable curve.
 */
export class SpeechLevel {
  private env: Uint8Array | null = null;
  private envKey = "";
  private speech: PresenceFrame["speech"] = null;
  private offset = 0;
  private level = 0;
  private held = 0;
  private heldAt = -1e9;
  analyser: (() => number) | null = null;

  setSpeech(speech: PresenceFrame["speech"], offsetMs: number): void {
    this.speech = speech;
    this.offset = offsetMs;
    const key = speech ? `${speech.segment}:${speech.started_at}:${speech.env.length}` : "";
    if (key !== this.envKey) {
      this.envKey = key;
      this.env = speech ? decodeEnvelope(speech.env) : null;
    }
  }

  get active(): boolean { return this.level > 0.005 || !!this.speech?.active || !!this.analyser; }

  /** Raw (unsmoothed) level at `now` (ms, local clock). */
  private raw(now: number): number {
    if (this.analyser) return this.analyser();
    const s = this.speech;
    if (!s || !s.active) return 0;
    if (this.env && this.env.length) {
      const pos = ((now - (s.started_at + this.offset)) / 1000) * s.env_hz;
      if (pos < 0 || pos > this.env.length) return 0;
      const i = Math.floor(pos);
      const a = this.env[Math.min(i, this.env.length - 1)];
      const b = this.env[Math.min(i + 1, this.env.length - 1)];
      return (a + (b - a) * (pos - i)) / 255;
    }
    return speechEnvelope(now);
  }

  /** `reduced`: two states at most 8 times a second (no flicker). */
  sample(now: number, dtMs: number, reduced = false): number {
    let target = this.raw(now);
    if (target < GATE) target = 0;
    if (reduced) {
      if (now - this.heldAt >= 125) { this.held = target > 0.35 ? 0.7 : 0; this.heldAt = now; }
      this.level = this.held;
      return this.level;
    }
    const tau = target > this.level ? ATTACK_MS : RELEASE_MS;
    this.level += (target - this.level) * (1 - Math.exp(-dtMs / tau));
    if (this.level < 0.01) this.level = 0;
    return Math.min(1, this.level * 1.05);
  }
}

/** Head/brow emphasis on loud syllables. */
export function emphasis(level: number): number {
  const x = Math.min(1, Math.max(0, (level - 0.7) / 0.3));
  return x * x * (3 - 2 * x);
}
