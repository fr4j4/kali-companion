import { describe, expect, it, vi } from "vitest";
import { PresenceStore } from "./presenceStore";
import type { PresenceFrame } from "./rig/types";

const frame = (over: Partial<PresenceFrame> = {}): PresenceFrame => ({
  event: "presence_state", v: 2, session_id: "s", seq: 1, t: 1000, connected: true,
  activity: { id: "reposo", since: 0 }, emotion: { id: "neutral", intensity: 0, since: 0, until: 0, source: "system" },
  gesture: null, speech: null, attention: "cursor", ...over,
});

describe("PresenceStore", () => {
  it("publishes the core's frames and estimates the clock offset by median", () => {
    let now = 5000;
    const store = new PresenceStore(() => now);
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.offset));
    for (const [local, core] of [[5000, 1000], [6000, 2000], [7000, 3040], [8000, 4000], [9000, 5900]]) {
      now = local;
      store.ingest(frame({ t: core }) as never);
    }
    expect(store.snapshot.offset).toBe(4000);
    expect(store.hasBrain).toBe(true);
    expect(store.snapshot.frame?.activity.id).toBe("reposo");
  });

  it("marks frames offline when the socket drops", () => {
    const store = new PresenceStore(() => 0);
    store.ingest(frame() as never);
    store.setConnected(false);
    expect(store.snapshot.frame?.connected).toBe(false);
    store.setConnected(true);
    expect(store.snapshot.frame?.connected).toBe(true);
  });

  it("falls back to the tracker with an old core and expires timed states by itself", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const store = new PresenceStore();
    store.ingest({ event: "ready" });
    store.ingest({ event: "tts_audio", duration: 1 });
    expect(store.snapshot.frame?.activity.id).toBe("hablando");
    expect(store.hasBrain).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(store.snapshot.frame?.activity.id).toBe("reposo");
    vi.useRealTimers();
  });

  it("once a brain frame arrived, raw events no longer drive the avatar", () => {
    const store = new PresenceStore(() => 0);
    store.ingest(frame() as never);
    store.ingest({ event: "tts_audio", duration: 3 });
    expect(store.snapshot.frame?.activity.id).toBe("reposo");
  });
});
