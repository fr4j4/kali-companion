import { describe, expect, it } from "vitest";
import { PcmTimeline } from "./pcmTimeline";
import { decodeTtsFrame } from "./ttsFrame";

describe("PcmTimeline", () => {
  it("chains chunks of a segment without gaps, after one jitter buffer", () => {
    const t = new PcmTimeline(0.1);
    const a = t.schedule(0, 0.05, 1.0);
    const b = t.schedule(0, 0.1, 1.02);
    expect(a.first).toBe(true);
    expect(a.startAt).toBeCloseTo(1.1);
    expect(b.first).toBe(false);
    expect(b.startAt).toBeCloseTo(a.endAt);
  });

  it("reports the end only after the final frame and the last chunk", () => {
    const t = new PcmTimeline(0.1);
    t.schedule(0, 0.05, 0);
    t.schedule(0, 0.05, 0);
    expect(t.chunkEnded(0)).toBe(false);
    expect(t.markFinal(0)).toBe(false);
    expect(t.chunkEnded(0)).toBe(true);
    expect(t.chunkEnded(0)).toBe(false); // only once
  });

  it("ends a segment whose final arrives after its audio already played", () => {
    const t = new PcmTimeline(0.1);
    t.schedule(2, 0.05, 0);
    expect(t.chunkEnded(2)).toBe(false);
    expect(t.markFinal(2)).toBe(true);
  });

  it("keeps segments and blocks in order on one clock", () => {
    const t = new PcmTimeline(0.1);
    const s0 = t.schedule(0, 0.5, 0);
    const s1 = t.schedule(1, 0.5, 0.2); // next segment arrives while the first still sounds
    expect(s1.first).toBe(true);
    expect(s1.startAt).toBeCloseTo(s0.endAt);
  });

  it("restarts behind the jitter buffer after an underrun", () => {
    const t = new PcmTimeline(0.1);
    t.schedule(0, 0.05, 0);
    const late = t.schedule(0, 0.05, 1.0);
    expect(late.startAt).toBeCloseTo(1.1);
  });

  it("starts a new turn's segment 0 fresh but after the audio still playing", () => {
    const t = new PcmTimeline(0.1);
    const old = t.schedule(0, 1, 0);
    t.newTurn();
    const next = t.schedule(0, 0.05, 0.5);
    expect(next.first).toBe(true);
    expect(next.startAt).toBeCloseTo(old.endAt);
  });

  it("waits for a reserved WAV segment", () => {
    const t = new PcmTimeline(0.1);
    t.reserve(3);
    expect(t.schedule(4, 0.05, 1).startAt).toBe(3);
  });
});

describe("decodeTtsFrame", () => {
  it("reads the header and the PCM", () => {
    const buf = new ArrayBuffer(16 + 4 * 2);
    const v = new DataView(buf);
    v.setUint8(0, 1);
    v.setUint8(1, 1);
    v.setUint16(2, 7, true);
    v.setUint32(4, 3, true);
    v.setUint32(8, 5, true);
    v.setUint32(12, 24000, true);
    new Int16Array(buf, 16, 4).set([1, -1, 300, -300]);
    const f = decodeTtsFrame(buf)!;
    expect(f).toMatchObject({ final: true, seq: 7, block_id: 3, segment: 5, sample_rate: 24000 });
    expect(Array.from(f.pcm)).toEqual([1, -1, 300, -300]);
    expect(f.duration).toBeCloseTo(4 / 24000);
  });

  it("ignores other frames", () => {
    expect(decodeTtsFrame(new ArrayBuffer(4))).toBeNull();
    const buf = new ArrayBuffer(16);
    new DataView(buf).setUint8(0, 9);
    expect(decodeTtsFrame(buf)).toBeNull();
  });
});
