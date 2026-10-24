// @ts-expect-error node builtin: the app tsconfig ships browser types only
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../avatarCatalog.gen";
import type { ActivityId, EmotionId, GestureId } from "../avatarCatalog.gen";
import { Blinker } from "./blink";
import { CHANNEL_IDS, browVisibility, compose, neutralChannels } from "./compose";
import { GazeController } from "./gaze";
import { MOTION_CHANNELS, gestureDef, sampleGesture } from "./gestures";
import { IdleDirector } from "./idle";
import { AvatarRig } from "./rig";
import { SpeechLevel, decodeEnvelope } from "./speech";
import { isSettled, stepSpring } from "./springs";
import type { PresenceFrame, RenderState } from "./types";

const ACTIVITIES = Object.keys(CATALOG.activities) as ActivityId[];
const EMOTIONS = Object.keys(CATALOG.emotions) as EmotionId[];
const GESTURES = Object.keys(CATALOG.gestures) as GestureId[];

function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function frame(over: Partial<PresenceFrame> = {}): PresenceFrame {
  return {
    event: "presence_state", v: 2, session_id: "s", seq: 1, t: 0, connected: true,
    activity: { id: "reposo", since: 0 }, emotion: { id: "neutral", intensity: 0, since: 0, until: 0, source: "system" },
    gesture: null, speech: null, attention: "cursor", ...over,
  };
}

class Capture {
  states: RenderState[] = [];
  render(s: RenderState) { this.states.push({ ...s }); }
  get last() { return this.states[this.states.length - 1]; }
}

function run(rig: AvatarRig, from: number, ms: number, step = 16) {
  let t = from;
  for (; t < from + ms; t += step) rig.tick(t);
  return t;
}

describe("catalog", () => {
  it("generated file is in sync with the core catalog", async () => {
    // @ts-expect-error plain .mjs generator without declarations
    const mod = await import("../../../scripts/gen-avatar-catalog.mjs");
    const fresh = mod.render(readFileSync(mod.SOURCE, "utf8"));
    expect(readFileSync(mod.TARGET, "utf8")).toBe(fresh);
  });

  it("every emotion, activity and gesture only touches known channels", () => {
    const known = new Set(CHANNEL_IDS);
    for (const a of ACTIVITIES) for (const ch of Object.keys(CATALOG.activities[a].delta)) expect(known.has(ch as never), `${a}.${ch}`).toBe(true);
    for (const e of EMOTIONS) for (const ch of Object.keys(CATALOG.emotions[e].delta)) expect(known.has(ch as never), `${e}.${ch}`).toBe(true);
    for (const g of GESTURES) for (const tr of gestureDef(g).tracks) expect(known.has(tr.ch)).toBe(true);
  });

  it("ships at least 18 emotions and 14 gestures", () => {
    expect(EMOTIONS.length).toBeGreaterThanOrEqual(18);
    expect(GESTURES.length).toBeGreaterThanOrEqual(14);
  });
});

describe("compose", () => {
  it("is defined, finite and within range for every activity x emotion x intensity", () => {
    for (const activity of ACTIVITIES) for (const id of EMOTIONS) for (const intensity of [0, 0.5, 1]) {
      const out = compose({ activity, emotion: { id, intensity }, fade: 1, speechLevel: 0 });
      for (const ch of CHANNEL_IDS) {
        const v = out.targets[ch];
        expect(Number.isFinite(v), `${activity}/${id}/${ch}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(CATALOG.channels[ch].min);
        expect(v).toBeLessThanOrEqual(CATALOG.channels[ch].max);
      }
      expect(CATALOG.mouthShapes).toContain(out.mouthShape);
      expect(CATALOG.symbols).toContain(out.symbol);
    }
  });

  it("neutral + rest equals the neutral pose", () => {
    const out = compose({ activity: "reposo", emotion: { id: "neutral", intensity: 0 }, fade: 1, speechLevel: 0 });
    expect(out.targets).toEqual(neutralChannels());
    expect(out.mouthShape).toBe("neutral");
  });

  it("working looks focused, never angry", () => {
    const work = compose({ activity: "trabajando", emotion: { id: "neutral", intensity: 0 }, fade: 1, speechLevel: 0 });
    const angry = compose({ activity: "reposo", emotion: { id: "molesto", intensity: 1 }, fade: 1, speechLevel: 0 });
    expect(work.targets.browAngle).toBeLessThan(0.2);
    expect(work.targets.lidSlant).toBe(0);
    expect(work.mouthShape).not.toBe("angry");
    expect(angry.targets.lidSlant).toBeGreaterThan(0.5);
    expect(angry.mouthShape).toBe("angry");
  });

  it("the activity scales the emotion: listening dampens it, sleeping removes it", () => {
    const at = (activity: ActivityId) => compose({ activity, emotion: { id: "alegre", intensity: 1 }, fade: 1, speechLevel: 0 }).strength;
    expect(at("reposo")).toBe(1);
    expect(at("escuchando")).toBeLessThan(1);
    expect(at("durmiendo")).toBe(0);
  });

  it("fades the emotion out and keeps symbols for strong feelings only", () => {
    const strong = compose({ activity: "reposo", emotion: { id: "triste", intensity: 1 }, fade: 1, speechLevel: 0 });
    const faint = compose({ activity: "reposo", emotion: { id: "triste", intensity: 0.5 }, fade: 1, speechLevel: 0 });
    expect(strong.symbol).toBe("tear");
    expect(faint.symbol).toBe("none");
    const faded = compose({ activity: "reposo", emotion: { id: "triste", intensity: 1 }, fade: 0, speechLevel: 0 });
    expect(faded.targets).toEqual(neutralChannels());
  });

  it("mouth shape follows the emotion while speaking, openness follows the voice", () => {
    const out = compose({ activity: "hablando", emotion: { id: "alegre", intensity: 0.8 }, fade: 1, speechLevel: 0.7 });
    expect(out.mouthShape).toBe("smile");
    expect(out.targets.mouthOpen).toBeCloseTo(0.7);
  });

  it("brows only show while they express something", () => {
    expect(browVisibility(0, 0, 0)).toBe(0);
    expect(browVisibility(0.05, 0, 0)).toBe(0);
    expect(browVisibility(0.8, 0, 0)).toBeGreaterThan(0.8);
  });
});

describe("springs", () => {
  it("converge without overshoot and independently of frame rate", () => {
    for (const dt of [1 / 120, 1 / 60, 1 / 20]) {
      const s = { x: 0, v: 0 };
      let max = 0;
      for (let t = 0; t < 2; t += dt) { stepSpring(s, 1, 12, dt); max = Math.max(max, s.x); }
      expect(max).toBeLessThanOrEqual(1.0001);
      expect(isSettled(s, 1)).toBe(true);
    }
    const a = { x: 0, v: 0 }, b = { x: 0, v: 0 };
    for (let i = 0; i < 60; i++) stepSpring(a, 1, 10, 1 / 60);
    for (let i = 0; i < 30; i++) stepSpring(b, 1, 10, 1 / 30);
    expect(a.x).toBeCloseTo(b.x, 4);
  });
});

describe("gestures", () => {
  it("every gesture starts and ends at (or returns to) rest", () => {
    for (const id of GESTURES) {
      const def = gestureDef(id);
      const end = sampleGesture(def, def.durMs);
      for (const v of Object.values(end)) expect(Math.abs(v as number)).toBeLessThan(0.0001);
      expect(sampleGesture(def, def.durMs + 1)).toEqual({});
      expect(sampleGesture(def, -1)).toEqual({});
    }
  });

  it("nod moves the head down and back", () => {
    const def = gestureDef("asentir");
    expect(sampleGesture(def, def.durMs * 0.25).headY).toBeGreaterThan(5);
  });

  it("reduced motion drops body/head motion and oscillations but keeps eyes and ears", () => {
    for (const id of GESTURES) {
      const out = sampleGesture(gestureDef(id), gestureDef(id).durMs * 0.4, { reduced: true });
      for (const ch of Object.keys(out)) expect(MOTION_CHANNELS.has(ch as never), `${id}.${ch}`).toBe(false);
    }
    expect(sampleGesture(gestureDef("ronroneo"), 800, { reduced: true }).bodyY).toBeUndefined();
    expect(sampleGesture(gestureDef("orejas_atras"), 400, { reduced: true }).earTilt).toBeLessThan(-0.5);
  });

  it("purr vibrates at about 2 Hz and ~1 px, not 4 Hz", () => {
    const def = gestureDef("ronroneo");
    let crossings = 0, prev = 0, peak = 0;
    for (let t = 400; t < 2000; t += 5) {
      const v = sampleGesture(def, t).bodyY ?? 0;
      peak = Math.max(peak, Math.abs(v));
      if (prev < 0 && v >= 0) crossings++;
      prev = v;
    }
    expect(peak).toBeLessThanOrEqual(1.01);
    expect(crossings / 1.6).toBeLessThanOrEqual(2.6);
  });
});

describe("blink", () => {
  it("blinks irregularly, in every activity but sleeping, never above 3 Hz", () => {
    const b = new Blinker(seeded(), 0);
    const starts: number[] = [];
    let wasOpen = true;
    for (let t = 0; t < 120_000; t += 8) {
      const f = b.factor(t, true);
      if (f < 1 && wasOpen) starts.push(t);
      wasOpen = f >= 1;
    }
    expect(starts.length).toBeGreaterThan(12);
    const gaps = starts.slice(1).map((s, i) => s - starts[i]);
    expect(Math.min(...gaps)).toBeGreaterThan(333);
    expect(new Set(gaps.map((g) => Math.round(g / 200))).size).toBeGreaterThan(5);
  });

  it("an eyelid blink reaches fully closed and recovers", () => {
    const b = new Blinker(() => 0.5, 0);
    const vals: number[] = [];
    for (let t = 0; t < 4600; t += 10) vals.push(b.factor(t, true));
    expect(Math.min(...vals)).toBeLessThan(0.05);
    expect(vals[vals.length - 1]).toBe(1);
  });

  it("does not blink when disabled", () => {
    const b = new Blinker(() => 0, 0);
    for (let t = 0; t < 20_000; t += 10) expect(b.factor(t, false)).toBe(1);
  });
});

describe("speech level", () => {
  const env = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
  it("decodes the core envelope", () => {
    expect(Array.from(decodeEnvelope(env([0, 128, 255]))!)).toEqual([0, 128, 255]);
    expect(decodeEnvelope("")).toBeNull();
  });

  it("follows the real energy: opens on loud, closes on quiet, gate removes noise", () => {
    const s = new SpeechLevel();
    s.setSpeech({ active: true, segment: 0, started_at: 1000, duration: 1000, env_hz: 10, env: env([255, 255, 0, 0, 0, 0, 255, 255, 255, 255]), estimated: false }, 0);
    const at = (ms: number) => { let v = 0; for (let t = ms - 200; t <= ms; t += 16) v = s.sample(t, 16); return v; };
    expect(at(1050)).toBeGreaterThan(0.7);
    expect(at(1400)).toBeLessThan(0.1);
    expect(at(1500)).toBe(0);
    expect(at(1750)).toBeGreaterThan(0.7);
  });

  it("falls back to a synthetic curve without envelope and closes after the speech", () => {
    const s = new SpeechLevel();
    s.setSpeech({ active: true, segment: 0, started_at: 0, duration: 1000, env_hz: 20, env: "", estimated: true }, 0);
    let max = 0;
    for (let t = 0; t < 1000; t += 16) max = Math.max(max, s.sample(t, 16));
    expect(max).toBeGreaterThan(0.3);
    s.setSpeech(null, 0);
    for (let t = 1000; t < 1400; t += 16) s.sample(t, 16);
    expect(s.sample(1400, 16)).toBe(0);
  });

  it("uses the analyser when present and quantises to two states in reduced motion", () => {
    const s = new SpeechLevel();
    let level = 0.8;
    s.analyser = () => level;
    let v = 0;
    for (let t = 0; t < 400; t += 16) v = s.sample(t, 16, true);
    expect(v).toBe(0.7);
    level = 0.1;
    for (let t = 400; t < 800; t += 16) v = s.sample(t, 16, true);
    expect(v).toBe(0);
  });
});

describe("gaze and idle", () => {
  it("resolves attention targets and stays inside the unit circle", () => {
    const g = new GazeController(seeded());
    expect(g.target("cursor", { cursor: { x: 3, y: 4 } }, 0, false)).toEqual({ x: 0.6, y: 0.8 });
    expect(g.target("input", {}, 0, false).y).toBeGreaterThan(0.5);
    expect(g.target("thought", {}, 0, false).y).toBeLessThan(0);
    expect(g.target("none", { cursor: { x: 1, y: 1 } }, 0, true)).toEqual({ x: 0, y: 0 });
  });

  it("idles with random gestures only at rest, yawns when relaxing, and not when disabled", () => {
    const idle = new IdleDirector(seeded(), 0);
    const seen = new Set<string>();
    for (let t = 0; t < 600_000; t += 1000) { const g = idle.update(t, "reposo", true); if (g) seen.add(g); }
    expect([...seen].every((g) => (CATALOG.idleGestures as readonly string[]).includes(g))).toBe(true);
    expect(seen.size).toBeGreaterThan(0);
    expect(idle.update(700_000, "relajado", true)).toBe("bostezo");
    const off = new IdleDirector(seeded(), 0);
    for (let t = 0; t < 600_000; t += 1000) expect(off.update(t, "reposo", false)).toBeNull();
    const busy = new IdleDirector(seeded(), 0);
    for (let t = 0; t < 600_000; t += 1000) expect(busy.update(t, "pensando", true)).toBeNull();
  });
});

describe("AvatarRig", () => {
  const make = (over: Partial<ConstructorParameters<typeof AvatarRig>[0]> = {}) => {
    const cap = new Capture();
    const rig = new AvatarRig({ renderer: cap, now: 0, rng: seeded(), ...over });
    return { rig, cap };
  };

  it("converges to the neutral pose and goes to rest", () => {
    const { rig, cap } = make({ perf: "performance" });
    rig.setFrame(frame(), 0);
    run(rig, 0, 3000);
    expect(cap.last.eyeOpenL).toBeGreaterThan(0.9);
    expect(cap.last.mouthShape).toBe("neutral");
  });

  it("an angry-free working turn: tool use never shows the angry mouth nor slanted lids", () => {
    const { rig, cap } = make();
    rig.setFrame(frame({ activity: { id: "trabajando", since: 0 }, attention: "work" }), 0);
    run(rig, 0, 2000);
    expect(cap.states.every((s) => s.mouthShape !== "angry")).toBe(true);
    expect(Math.max(...cap.states.map((s) => Math.abs(s.lidSlant)))).toBe(0);
  });

  it("molesto emotion eventually slants the lids and flattens the ears", () => {
    const { rig, cap } = make({ perf: "quality" });
    rig.setFrame(frame({ emotion: { id: "molesto", intensity: 1, since: 0, until: 100_000, source: "llm" } }), 0, 0);
    run(rig, 0, 2000);
    expect(cap.last.lidSlant).toBeGreaterThan(0.6);
    expect(cap.last.earL).toBeLessThan(-0.8);
    expect(cap.last.mouthShape).toBe("angry");
  });

  it("head tilt from an emotion survives gaze movement (separate layers)", () => {
    const { rig, cap } = make({ perf: "quality" });
    rig.setFrame(frame({ emotion: { id: "confundido", intensity: 1, since: 0, until: 100_000, source: "llm" } }), 0);
    rig.setGaze({ cursor: { x: 0.9, y: 0 } });
    run(rig, 0, 3000);
    expect(cap.last.headTilt).toBeGreaterThan(8 + 3);
  });

  it("plays a new gesture once, ignores the first frame's gesture and stale ones", () => {
    const { rig, cap } = make({ perf: "quality" });
    rig.setFrame(frame({ gesture: { id: "asentir", gid: 5, at: 0 } }), 0);
    run(rig, 0, 800);
    expect(Math.max(...cap.states.map((s) => s.headY))).toBeLessThan(1);
    cap.states.length = 0;
    rig.setFrame(frame({ gesture: { id: "asentir", gid: 6, at: 1000 } }), 1000, 0);
    run(rig, 1000, 900);
    expect(Math.max(...cap.states.map((s) => s.headY))).toBeGreaterThan(3);
    cap.states.length = 0;
    rig.setFrame(frame({ gesture: { id: "asentir", gid: 6, at: 1000 } }), 3000, 0);
    rig.setFrame(frame({ gesture: { id: "asentir", gid: 7, at: 500 } }), 3000, 0); // 2.5 s late
    run(rig, 3000, 900);
    expect(Math.max(...cap.states.map((s) => s.headY))).toBeLessThan(1);
  });

  it("opens the mouth with the speech envelope", () => {
    const { rig, cap } = make({ perf: "quality" });
    const env = btoa(String.fromCharCode(...new Array(20).fill(255)));
    rig.setFrame(frame({ activity: { id: "hablando", since: 0 }, speech: { active: true, segment: 0, started_at: 0, duration: 1000, env_hz: 20, env, estimated: false } }), 0);
    run(rig, 0, 800);
    expect(Math.max(...cap.states.map((s) => s.mouthOpen))).toBeGreaterThan(0.7);
    rig.setFrame(frame(), 1000);
    run(rig, 1000, 1500);
    expect(cap.last.mouthOpen).toBeLessThan(0.02);
  });

  it("asleep: eyes closed, no blinking, breathing still on in balanced", () => {
    const { rig, cap } = make();
    rig.setFrame(frame({ activity: { id: "durmiendo", since: 0 } }), 0);
    run(rig, 0, 12_000);
    expect(cap.last.eyeOpenL).toBeLessThan(0.1);
    expect(cap.last.asleep).toBe(true);
    expect(cap.last.symbol).toBe("zz");
  });

  it("offline when the frame is missing or disconnected", () => {
    const { rig } = make();
    expect(rig.activity).toBe("offline");
    rig.setFrame(frame({ connected: false }), 0);
    expect(rig.activity).toBe("offline");
    rig.setFrame(frame(), 0);
    expect(rig.activity).toBe("reposo");
  });

  it("performance profile: no breathing, no whiskers, no halo, and the rig rests", () => {
    const { rig, cap } = make({ perf: "performance" });
    rig.setFrame(frame(), 0);
    run(rig, 0, 6000);
    expect(cap.last.bodyY).toBeCloseTo(0, 5);
    expect(cap.last.whisker).toBe(0);
    expect(cap.last.halo).toBe(0);
    expect(rig.resting).toBe(true);
    expect(rig.nextWakeMs(6000)).toBeGreaterThanOrEqual(1000 / CATALOG.perf.performance.fps);
  });

  it("balanced/quality breathe and use the fps budget while busy", () => {
    const { rig, cap } = make({ perf: "balanced" });
    rig.setFrame(frame(), 0);
    run(rig, 0, 6000);
    expect(new Set(cap.states.map((s) => s.bodyY.toFixed(2))).size).toBeGreaterThan(10);
    rig.setFrame(frame({ activity: { id: "pensando", since: 6000 } }), 6000);
    rig.tick(6016);
    expect(rig.nextWakeMs(6016)).toBeCloseTo(1000 / CATALOG.perf.balanced.fps);
  });

  it("reduced motion: no breathing, no gaze following, no whisker, no motion gestures", () => {
    const { rig, cap } = make({ perf: "quality", reduced: true });
    rig.setFrame(frame({ gesture: null }), 0);
    rig.setFrame(frame({ gesture: { id: "celebrar", gid: 2, at: 1000 } }), 1000, 0);
    rig.setGaze({ cursor: { x: 1, y: 0 } });
    run(rig, 0, 4000);
    expect(cap.states.every((s) => s.bodyY === 0 && s.whisker === 0 && s.headX === 0 && s.headTilt === 0)).toBe(true);
    expect(Math.max(...cap.states.map((s) => s.pupilX))).toBeLessThan(0.5 * 18 + 0.0001 + 18);
  });

  it("the cat gets slit pupils when angry, the dog does not", () => {
    for (const [species, expected] of [["gato", true], ["perro", false]] as const) {
      const { rig, cap } = make({ species, perf: "quality" });
      rig.setFrame(frame({ emotion: { id: "molesto", intensity: 1, since: 0, until: 100_000, source: "llm" } }), 0);
      run(rig, 0, 2000);
      expect(cap.last.pupilSlit > 0.5).toBe(expected);
    }
  });

  it("is deterministic for a given seed and clock", () => {
    const a = make({ perf: "quality" }), b = make({ perf: "quality" });
    for (const { rig } of [a, b]) { rig.setFrame(frame({ emotion: { id: "alegre", intensity: 0.8, since: 0, until: 9e9, source: "llm" } }), 0); run(rig, 0, 2000); }
    expect(a.cap.states).toEqual(b.cap.states);
  });
});
