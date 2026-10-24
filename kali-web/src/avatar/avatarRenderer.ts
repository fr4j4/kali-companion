import { browVisibility } from "./rig/compose";
import type { RenderState, RigRenderer } from "./rig/types";

const HALO_COLORS: Record<RenderState["tone"], string> = {
  accent: "", // falls back to the theme's --accent
  think: "#C77DFF",
  wait: "#E8A24C",
  work: "#4FD1C5",
  sleep: "#7A7068",
  alert: "#E87A5C",
};

export const LID_TRAVEL = 214; // px the upper lid travels from fully open to fully closed
const LOWER_LID_TRAVEL = 75;
const SLANT_DEG = 22;
const CLOSED_FROM = 0.2; // eye opening at which the closed-eye line starts to fade in
const CLOSED_TO = 0.04;
const CLOSED_LINE_Y = 522;
const MOUTH_X_SCALE: Record<string, number> = { smile: 1.12, o: 0.8, angry: 0.9, frown: 0.95, flat: 0.95 };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Writes a RenderState to the avatar SVG; touches the DOM only for values that changed. */
export class SvgRenderer implements RigRenderer {
  private cache = new Map<unknown, string>();
  private body: SVGGElement | null;
  private halo: SVGGElement | null;
  private head: SVGGElement | null;
  private upperL: SVGGElement | null;
  private upperR: SVGGElement | null;
  private lowerL: SVGGElement | null;
  private lowerR: SVGGElement | null;
  private eyeL: SVGGElement | null;
  private eyeR: SVGGElement | null;
  private closedL: SVGElement | null;
  private closedR: SVGElement | null;
  private pupilL: SVGGElement | null;
  private pupilR: SVGGElement | null;
  private cores: SVGElement[];
  private shines: SVGElement[];
  private browL: SVGElement | null;
  private browR: SVGElement | null;
  private cheeks: SVGElement[];
  private earsL: SVGElement[];
  private earsR: SVGElement[];
  private whiskL: SVGElement[];
  private whiskR: SVGElement[];
  private opens: SVGElement[];
  private symbols: SVGElement | null;

  constructor(private svg: SVGSVGElement) {
    const q = <T extends Element>(s: string) => svg.querySelector(s) as T | null;
    const all = (s: string) => Array.from(svg.querySelectorAll<SVGElement>(s));
    this.body = q(".avatar-animate");
    this.halo = q(".presence-halo");
    this.head = q("#head-pivot");
    this.upperL = q("#eye-left .upper-lid");
    this.upperR = q("#eye-right .upper-lid");
    this.lowerL = q("#eye-left .lower-lid");
    this.lowerR = q("#eye-right .lower-lid");
    this.eyeL = q("#eye-left");
    this.eyeR = q("#eye-right");
    this.closedL = q(".eye-closed-left");
    this.closedR = q(".eye-closed-right");
    this.pupilL = q("#pupil-left-group");
    this.pupilR = q("#pupil-right-group");
    this.cores = all(".pupil-core");
    this.shines = all(".shine-main, .shine-sub");
    this.browL = q(".brow-left");
    this.browR = q(".brow-right");
    this.cheeks = all(".cheek-left, .cheek-right");
    this.earsL = all(".left-ear");
    this.earsR = all(".right-ear");
    this.whiskL = all(".left-whiskers");
    this.whiskR = all(".right-whiskers");
    this.opens = all(".mouth-opened");
    this.symbols = q("#symbols");
  }

  private put(key: unknown, value: string, write: () => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    write();
  }

  private style(el: Element | null, prop: "transform" | "opacity", value: string): void {
    if (!el) return;
    this.put(`${prop}:${this.idx(el)}`, value, () => ((el as SVGElement).style[prop] = value));
  }

  private ids = new WeakMap<Element, number>();
  private n = 0;
  private idx(el: Element): number {
    let i = this.ids.get(el);
    if (i === undefined) this.ids.set(el, (i = ++this.n));
    return i;
  }

  private attr(el: Element | null, name: string, value: string): void {
    if (!el) return;
    this.put(`@${name}:${this.idx(el)}`, value, () => el.setAttribute(name, value));
  }

  render(s: RenderState): void {
    const svg = this.svg;
    this.put("mouth", s.mouthShape, () => svg.setAttribute("data-mouth", s.mouthShape));
    this.put("talk", s.mouthOpen > 0.04 ? "1" : "0", () => svg.setAttribute("data-talk", s.mouthOpen > 0.04 ? "1" : "0"));
    this.put("symbol", s.symbol, () => svg.setAttribute("data-symbol", s.symbol));
    this.put("asleep", String(s.asleep), () => svg.setAttribute("data-asleep", String(s.asleep)));
    this.put("tone", s.tone, () => {
      const c = HALO_COLORS[s.tone];
      if (c) svg.style.setProperty("--halo-color", c);
      else svg.style.removeProperty("--halo-color");
    });

    this.style(this.body, "transform", `translateY(${r2(s.bodyY)}px) scale(${r2(s.bodyScale * 1000) / 1000})`);
    this.style(this.halo, "opacity", String(r2(s.halo)));
    this.style(this.halo, "transform", `scale(${r2(s.haloScale * 1000) / 1000})`);
    this.style(this.head, "transform", `translate(${r2(s.headX)}px, ${r2(s.headY)}px) rotate(${r2(s.headTilt)}deg)`);

    const lid = (open: number) => r2((1 - Math.min(1.2, open)) * LID_TRAVEL);
    this.attr(this.upperL, "transform", `translate(0 ${lid(s.eyeOpenL)}) rotate(${r2(s.lidSlant * SLANT_DEG)} 355 480)`);
    this.attr(this.upperR, "transform", `translate(0 ${lid(s.eyeOpenR)}) rotate(${r2(-s.lidSlant * SLANT_DEG)} 645 480)`);
    this.attr(this.lowerL, "transform", `translate(0 ${r2(-s.lowerLid * LOWER_LID_TRAVEL)})`);
    this.attr(this.lowerR, "transform", `translate(0 ${r2(-s.lowerLid * LOWER_LID_TRAVEL)})`);

    // A nearly shut eye reads better as a single line than as a white disc: cross-fade to the closed-eye
    // stroke (an arch when the cheeks are pushed up, a soft curve otherwise).
    const closing = (open: number) => {
      const c = Math.min(1, Math.max(0, (CLOSED_FROM - open) / (CLOSED_FROM - CLOSED_TO)));
      return c * c * (3 - 2 * c);
    };
    const happy = s.lowerLid > 0.35;
    const flip = happy ? `translate(0 ${2 * CLOSED_LINE_Y}) scale(1 -1)` : "";
    for (const [eye, line, open] of [[this.eyeL, this.closedL, s.eyeOpenL], [this.eyeR, this.closedR, s.eyeOpenR]] as const) {
      const c = r2(closing(open) * 100) / 100;
      this.attr(eye, "opacity", String(r2((1 - c) * 100) / 100));
      this.attr(line, "opacity", String(c));
      this.attr(line, "transform", flip);
    }

    const look = `translate(${r2(s.pupilX)}px, ${r2(s.pupilY)}px)`;
    this.style(this.pupilL, "transform", look);
    this.style(this.pupilR, "transform", look);
    const sx = r2(s.pupilScale * (1 - s.pupilSlit * 0.88) * 100) / 100;
    for (const c of this.cores) this.style(c, "transform", `scale(${sx}, ${r2(s.pupilScale * 100) / 100})`);
    const shine = r2(Math.min(1, 0.4 + 0.6 * s.pupilScale) * 100) / 100;
    for (const c of this.shines) this.style(c, "transform", `scale(${shine})`);

    const asym = s.browAsym * 10;
    const rise = -s.browY * 16;
    this.attr(this.browL, "transform", `translate(0 ${r2(rise - asym)}) rotate(${r2(s.browAngle * 18)} 355 380)`);
    this.attr(this.browR, "transform", `translate(0 ${r2(rise + asym)}) rotate(${r2(-s.browAngle * 18)} 645 380)`);
    const bo = String(r2(browVisibility(s.browY, s.browAngle, s.browAsym)));
    this.attr(this.browL, "opacity", bo);
    this.attr(this.browR, "opacity", bo);
    for (const c of this.cheeks) this.attr(c, "opacity", String(r2(Math.min(1, s.blush) * 0.55)));

    const ear = (e: number, side: 1 | -1) =>
      e >= 0 ? `rotate(${r2(side * e * 6)}deg) scale(${r2(1 + e * 0.05)})` : `rotate(${r2(side * e * 38)}deg) translateY(${r2(-e * 12)}px)`;
    for (const el of this.earsL) this.style(el, "transform", ear(s.earL, 1));
    for (const el of this.earsR) this.style(el, "transform", ear(s.earR, -1));

    for (const el of this.whiskL) this.style(el, "transform", `translateX(${r2(2 * s.whisker)}px) rotate(${r2(-0.75 * s.whisker)}deg)`);
    for (const el of this.whiskR) this.style(el, "transform", `translateX(${r2(-2 * s.whisker)}px) rotate(${r2(0.75 * s.whisker)}deg)`);

    const open = Math.min(1, Math.max(0, s.mouthOpen));
    const wide = MOUTH_X_SCALE[s.mouthShape] ?? 1;
    const t = open > 0.04
      ? `translateY(${r2((1 - open) * 4)}px) scale(${r2((0.9 + open * 0.18) * wide * 100) / 100}, ${r2((0.24 + open * 0.76) * 100) / 100})`
      : "none";
    for (const el of this.opens) {
      this.style(el, "transform", t);
      this.style(el, "opacity", open > 0.04 ? "1" : "0");
    }

    this.style(this.symbols, "opacity", String(r2(s.symbolOpacity)));
  }
}
