const CLOSE_MS = 60;
const OPEN_MS = 80;
export const BLINK_MS = CLOSE_MS + OPEN_MS;
const DOUBLE_CHANCE = 0.12;
const DOUBLE_GAP_MS = 220;

/** Stochastic blinking: gamma-ish intervals (2.5–6 s), occasional double blinks, 140 ms long. */
export class Blinker {
  private nextAt: number;
  private startedAt = -1;
  constructor(private rng: () => number, now: number, private slow = false) {
    this.nextAt = now + this.interval();
  }

  private interval(): number {
    return (2500 + this.rng() * 3500) * (this.slow ? 1.5 : 1);
  }

  setSlow(slow: boolean): void { this.slow = slow; }

  /** A big gaze jump often comes with a blink. */
  nudge(now: number): void {
    if (this.startedAt < 0 && this.rng() < 0.3) this.nextAt = Math.min(this.nextAt, now + 40);
  }

  get blinking(): boolean { return this.startedAt >= 0; }
  get nextBlinkAt(): number { return this.nextAt; }

  /** Eyelid multiplier in [0, 1] (1 = open). */
  factor(now: number, enabled: boolean): number {
    if (!enabled) { this.startedAt = -1; this.nextAt = Math.max(this.nextAt, now + 1000); return 1; }
    if (this.startedAt < 0) {
      if (now < this.nextAt) return 1;
      this.startedAt = now;
    }
    const t = now - this.startedAt;
    if (t >= BLINK_MS) {
      this.startedAt = -1;
      this.nextAt = now + (this.rng() < DOUBLE_CHANCE ? DOUBLE_GAP_MS : this.interval());
      return 1;
    }
    return t < CLOSE_MS ? 1 - t / CLOSE_MS : (t - CLOSE_MS) / OPEN_MS;
  }
}
