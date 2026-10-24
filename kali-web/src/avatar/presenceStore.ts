/**
 * avatar/presenceStore.ts — What every avatar view renders: the core's latest `presence_state` frame
 * plus the clock offset needed to read its timestamps.
 *
 * Views fed by a core without the avatar brain (no `presence_state`) fall back to the local
 * AvatarStateTracker, which derives an equivalent frame from the raw event stream.
 */

import { AvatarStateTracker, viewToFrame, type PresenceEvent } from "./avatarState";
import type { PresenceFrame } from "./rig/types";

export interface PresenceSnapshot {
  frame: PresenceFrame | null;
  /** local clock - core clock, in ms (median of the last few frames). */
  offset: number;
  connected: boolean;
}

type Listener = (snap: PresenceSnapshot) => void;

const OFFSET_WINDOW = 5;

export class PresenceStore {
  private frame: PresenceFrame | null = null;
  private offsets: number[] = [];
  private connected = false;
  private v2 = false;
  private tracker = new AvatarStateTracker();
  private listeners = new Set<Listener>();
  private snap: PresenceSnapshot = { frame: null, offset: 0, connected: false };
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private clock: () => number = () => Date.now()) {}

  get snapshot(): PresenceSnapshot { return this.snap; }
  get hasBrain(): boolean { return this.v2; }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private publish(): void {
    const offset = this.offsets.length ? [...this.offsets].sort((a, b) => a - b)[Math.floor(this.offsets.length / 2)] : 0;
    this.snap = { frame: this.frame ? { ...this.frame, connected: this.connected && this.frame.connected } : null, offset, connected: this.connected };
    for (const l of this.listeners) l(this.snap);
  }

  setConnected(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    if (!connected) { this.frame = this.v2 ? this.frame : null; this.tracker.apply({ event: "disconnected" }, this.clock()); }
    this.publish();
  }

  /** Feed any core event (the avatar ignores the ones it does not care about). */
  ingest(ev: PresenceEvent): void {
    const now = this.clock();
    if (ev.event === "presence_state" && ev.v === 2) {
      const frame = ev as unknown as PresenceFrame;
      this.v2 = true;
      this.connected = true;
      this.frame = frame;
      this.offsets.push(now - frame.t);
      if (this.offsets.length > OFFSET_WINDOW) this.offsets.shift();
      this.publish();
      return;
    }
    if (ev.event === "ready") { this.connected = true; if (this.v2 && ev.presence_v !== 2) this.v2 = false; }
    if (ev.event === "disconnected") { this.connected = false; }
    if (this.v2) { if (ev.event === "ready" || ev.event === "disconnected") this.publish(); return; }
    this.tracker.apply(ev, now);
    this.refreshFromTracker();
  }

  private refreshFromTracker(): void {
    const now = this.clock();
    this.frame = viewToFrame(this.tracker.view(now), now);
    this.offsets = [0];
    this.publish();
    clearTimeout(this.timer);
    const deadline = this.tracker.nextDeadline(now);
    if (deadline) this.timer = setTimeout(() => this.refreshFromTracker(), Math.max(deadline - now, 0) + 20);
  }
}
