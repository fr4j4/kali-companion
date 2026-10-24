import { CATALOG } from "../avatarCatalog.gen";
import type { ActivityId, ChannelId, GestureId, MouthShape, PerfProfileId, SymbolId } from "../avatarCatalog.gen";
import { Blinker } from "./blink";
import { CHANNEL_IDS, clampChannel, compose, neutralChannels } from "./compose";
import { GazeController } from "./gaze";
import { gestureDef, sampleGesture } from "./gestures";
import { IdleDirector } from "./idle";
import { SpeechLevel, emphasis } from "./speech";
import { isSettled, stepSpring, type Spring } from "./springs";
import type { Channels, GazePoints, PresenceFrame, RenderState, RigRenderer } from "./types";

export type Species = "gato" | "perro" | "erizo";

export interface PerfDef { fps: number; breath: boolean; halo: "animated" | "static" | "none"; whiskers: boolean; micro: boolean; gestures: "all" | "semantic"; shadow: boolean }

/** Response speed (rad/s) per channel: eyes snap, ears and head are heavier. */
const OMEGA: Record<ChannelId, number> = {
  eyeOpenL: 25, eyeOpenR: 25, lowerLid: 18, lidSlant: 14, pupilScale: 18, pupilSlit: 14,
  browY: 12, browAngle: 12, browAsym: 12, blush: 6, earTilt: 8, earAsym: 10,
  headTilt: 6, headY: 6, bodyY: 10, mouthOpen: 40, gazeX: 18, gazeY: 18, halo: 3, whisker: 4, breath: 3,
};
const REDUCED_OMEGA = 18;
const HEAD_FOLLOW = 0.6;
const BREATH_PERIOD_MS: Partial<Record<ActivityId, number>> = {
  reposo: 4600, escuchando: 3600, hablando: 2800, durmiendo: 6000, relajado: 6000, pensando: 5800, trabajando: 4000,
};

export interface RigOptions {
  renderer: RigRenderer;
  now?: number;
  rng?: () => number;
  perf?: PerfProfileId;
  reduced?: boolean;
  species?: Species;
}

const EMPTY_STATE_SYMBOL: SymbolId = "none";

export class AvatarRig {
  private renderer: RigRenderer;
  private perfId: PerfProfileId;
  private reduced: boolean;
  private species: Species;
  private frame: PresenceFrame | null = null;
  private offset = 0;
  private points: GazePoints = {};
  private springs = {} as Record<ChannelId, Spring>;
  private headGaze = { x: { x: 0, v: 0 } as Spring, y: { x: 0, v: 0 } as Spring };
  private symbolFade: Spring = { x: 0, v: 0 };
  private shownSymbol: SymbolId = EMPTY_STATE_SYMBOL;
  private lastMouth: MouthShape = "neutral";
  private blink: Blinker;
  private gaze: GazeController;
  private idle: IdleDirector;
  readonly speech = new SpeechLevel();
  private gesture: { id: GestureId; start: number; prio: number } | null = null;
  private seenGid: number | null = null;
  private last: number;
  private breathPhase = 0;
  private busy = true;
  private kickFn: (() => void) | null = null;
  /** Last rendered state (tests / debugging). */
  state: RenderState | null = null;

  constructor(opts: RigOptions) {
    this.renderer = opts.renderer;
    this.perfId = opts.perf ?? "balanced";
    this.reduced = opts.reduced ?? false;
    this.species = opts.species ?? "gato";
    const now = opts.now ?? 0;
    const rng = opts.rng ?? Math.random;
    this.last = now;
    const n = neutralChannels();
    for (const id of CHANNEL_IDS) this.springs[id] = { x: n[id], v: 0 };
    this.blink = new Blinker(rng, now, this.reduced);
    this.gaze = new GazeController(rng);
    this.idle = new IdleDirector(rng, now);
  }

  get perf(): PerfDef { return CATALOG.perf[this.perfId] as PerfDef; }
  get isReduced() { return this.reduced; }
  get activity(): ActivityId { return !this.frame || !this.frame.connected ? "offline" : this.frame.activity.id; }

  setKick(fn: (() => void) | null): void { this.kickFn = fn; }
  private kick(): void { this.busy = true; this.kickFn?.(); }

  setPerf(id: PerfProfileId): void { if (id !== this.perfId) { this.perfId = id; this.kick(); } }
  setReducedMotion(reduced: boolean): void { if (reduced !== this.reduced) { this.reduced = reduced; this.blink.setSlow(reduced); this.kick(); } }
  setSpecies(species: Species): void { this.species = species; this.kick(); }
  setGaze(points: GazePoints): void { this.points = points; this.busy = true; this.kickFn?.(); }
  setAnalyser(level: (() => number) | null): void { this.speech.analyser = level; this.kick(); }

  /** Feed the latest frame; `offsetMs` converts core times to this clock (local = core + offset). */
  setFrame(frame: PresenceFrame | null, now: number, offsetMs = 0): void {
    this.frame = frame;
    this.offset = offsetMs;
    this.speech.setSpeech(frame?.speech ?? null, offsetMs);
    if (frame?.gesture) {
      const g = frame.gesture;
      if (this.seenGid === null) {
        this.seenGid = g.gid; // first frame after (re)connecting: never replay an old gesture
      } else if (g.gid !== this.seenGid) {
        this.seenGid = g.gid;
        if (now - (g.at + offsetMs) <= CATALOG.engine.gestureStaleMs) this.play(g.id, now);
      }
    } else if (this.seenGid === null) {
      this.seenGid = -1;
    }
    this.kick();
  }

  private play(id: GestureId, now: number): void {
    const def = gestureDef(id);
    if (this.perf.gestures === "semantic" && !def.semantic) return;
    if (this.gesture && now - this.gesture.start < gestureDef(this.gesture.id).durMs && this.gesture.prio > def.priority) return;
    this.gesture = { id, start: now, prio: def.priority };
    if (id === "mirar_alrededor") this.blink.nudge(now);
  }

  /** Advance the animation to `now` (ms) and paint. */
  tick(now: number): void {
    const dtMs = Math.min(100, Math.max(0, now - this.last));
    this.last = now;
    const dt = dtMs / 1000;
    const perf = this.perf;
    const reduced = this.reduced;
    const activity = this.activity;
    const asleep = activity === "durmiendo";
    const fr = this.frame;

    const idleGesture = this.idle.update(now, activity, perf.micro && !reduced);
    if (idleGesture) this.play(idleGesture, now);

    let sample: Partial<Channels> | null = null;
    if (this.gesture) {
      const def = gestureDef(this.gesture.id);
      const elapsed = now - this.gesture.start;
      if (elapsed > def.durMs) this.gesture = null;
      else sample = sampleGesture(def, elapsed, { reduced });
    }

    const speechLevel = this.speech.sample(now, dtMs, reduced);
    const emo = fr?.emotion ?? { id: "neutral" as const, intensity: 0, since: 0, until: 0, source: "system" };
    let fade = 1;
    if (emo.until) fade = Math.min(1, Math.max(0, (emo.until + this.offset - now) / CATALOG.engine.emotionFadeMs));
    const out = compose({ activity, emotion: emo, fade, gesture: sample, speechLevel });
    const t = out.targets;

    const gz = this.gaze.target(fr?.attention ?? "cursor", this.points, now, perf.micro && !reduced && !asleep);
    t.gazeX = clampChannel("gazeX", t.gazeX + gz.x);
    t.gazeY = clampChannel("gazeY", t.gazeY + gz.y);
    const emph = activity === "hablando" ? emphasis(speechLevel) : 0;
    t.browY = clampChannel("browY", t.browY + 0.1 * emph);
    t.headY = clampChannel("headY", t.headY + emph);

    let settled = true;
    for (const id of CHANNEL_IDS) {
      const s = this.springs[id];
      stepSpring(s, t[id], reduced && id !== "mouthOpen" ? REDUCED_OMEGA : OMEGA[id], dt);
      if (!isSettled(s, t[id])) settled = false;
    }
    stepSpring(this.headGaze.x, t.gazeX, reduced ? 0 : 6, dt);
    stepSpring(this.headGaze.y, t.gazeY, reduced ? 0 : 6, dt);
    if (reduced) { this.headGaze.x.x = 0; this.headGaze.y.x = 0; }
    else if (!isSettled(this.headGaze.x, t.gazeX) || !isSettled(this.headGaze.y, t.gazeY)) settled = false;

    if (out.symbol !== "none") this.shownSymbol = out.symbol;
    const symbolTarget = out.symbol === "none" ? 0 : 1;
    stepSpring(this.symbolFade, symbolTarget, reduced ? REDUCED_OMEGA : 14, dt);
    if (!isSettled(this.symbolFade, symbolTarget)) settled = false;
    if (this.symbolFade.x < 0.01 && symbolTarget === 0) this.shownSymbol = "none";
    this.lastMouth = out.mouthShape;

    const blinkF = this.blink.factor(now, !asleep && activity !== "offline");
    const sp = this.springs;

    let breathY = 0;
    let bodyScale = 1;
    if (perf.breath && !reduced) {
      const period = BREATH_PERIOD_MS[activity] ?? 4600;
      const k = 0.7 + 0.3 * Math.min(2.5, Math.max(0.3, sp.breath.x));
      this.breathPhase += (dt * 2 * Math.PI * k) / (period / 1000);
      const s = Math.sin(this.breathPhase);
      breathY = -s * 3 * sp.breath.x;
      bodyScale = 1 + 0.008 * s * sp.breath.x;
    }

    const haloAnimated = perf.halo === "animated" && !reduced;
    const haloPulse = haloAnimated ? Math.sin((now / 1000) * ((2 * Math.PI) / 6.4)) : 0;
    const whiskerSway = perf.whiskers && !reduced ? sp.whisker.x * Math.sin((now / 1000) * ((2 * Math.PI) / (activity === "hablando" ? 5.5 : 9))) : 0;

    const state: RenderState = {
      eyeOpenL: sp.eyeOpenL.x * blinkF,
      eyeOpenR: sp.eyeOpenR.x * blinkF,
      lowerLid: sp.lowerLid.x,
      lidSlant: sp.lidSlant.x,
      pupilScale: sp.pupilScale.x,
      pupilSlit: this.species === "gato" ? sp.pupilSlit.x : 0,
      pupilX: sp.gazeX.x * 18,
      pupilY: sp.gazeY.x * 18,
      browY: sp.browY.x,
      browAngle: sp.browAngle.x,
      browAsym: sp.browAsym.x,
      blush: sp.blush.x,
      earL: sp.earTilt.x + sp.earAsym.x * 0.5,
      earR: sp.earTilt.x - sp.earAsym.x * 0.5,
      headTilt: sp.headTilt.x + this.headGaze.x.x * 10 * HEAD_FOLLOW,
      headX: this.headGaze.x.x * 22 * HEAD_FOLLOW,
      headY: sp.headY.x + this.headGaze.y.x * 14 * HEAD_FOLLOW,
      bodyY: sp.bodyY.x + breathY,
      bodyScale,
      mouthOpen: sp.mouthOpen.x,
      mouthShape: this.lastMouth,
      symbol: this.shownSymbol,
      symbolOpacity: Math.min(1, Math.max(0, this.symbolFade.x)),
      tone: out.tone,
      halo: perf.halo === "none" ? 0 : sp.halo.x * (1 + 0.2 * haloPulse),
      haloScale: 1 + 0.03 * haloPulse,
      whisker: whiskerSway,
      asleep,
    };
    this.state = state;
    this.renderer.render(state);

    this.busy = !settled || this.speech.active || this.gesture !== null || this.blink.blinking;
  }

  /** ms until the next tick is needed; Infinity never happens (blink and idle timers always exist). */
  nextWakeMs(now: number): number {
    const frameMs = 1000 / this.perf.fps;
    if (this.busy) return frameMs;
    const ambient = !this.reduced && (this.perf.breath || this.perf.whiskers || this.perf.halo === "animated");
    if (ambient) return 100;
    const next = Math.min(this.blink.nextBlinkAt, this.idle.nextAtMs);
    return Math.min(5000, Math.max(frameMs, next - now));
  }

  /** Whether the rig is fully at rest (nothing to animate until an event or timer). */
  get resting(): boolean { return !this.busy; }
}
