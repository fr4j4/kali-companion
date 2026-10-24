import type { AttentionId } from "../avatarCatalog.gen";
import type { GazePoints } from "./types";

const clampLen = (x: number, y: number) => {
  const d = Math.hypot(x, y);
  return d > 1 ? { x: x / d, y: y / d } : { x, y };
};

/** Resolves a semantic attention target to normalised coordinates, with micro-saccades. */
export class GazeController {
  private sx = 0;
  private sy = 0;
  private nextSaccade = 0;
  constructor(private rng: () => number) {}

  target(attention: AttentionId, points: GazePoints, now: number, saccades: boolean): { x: number; y: number } {
    let x = 0;
    let y = 0;
    switch (attention) {
      case "cursor": ({ x, y } = points.cursor ?? { x: 0, y: 0 }); break;
      case "input": ({ x, y } = points.input ?? { x: 0, y: 0.7 }); break;
      case "thought": ({ x, y } = points.thought ?? { x: 0.55, y: -0.5 }); break;
      case "work": x = -0.35 + (saccades ? 0.25 * Math.sin(now / 700) : 0); y = 0.6; break;
      case "user": y = 0.05; break;
      case "none": break;
    }
    if (saccades && attention !== "none") {
      if (now >= this.nextSaccade) {
        this.sx = (this.rng() - 0.5) * 0.12;
        this.sy = (this.rng() - 0.5) * 0.12;
        this.nextSaccade = now + 1500 + this.rng() * 2500;
      }
      x += this.sx;
      y += this.sy;
    }
    return clampLen(x, y);
  }
}
