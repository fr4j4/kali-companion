import { CATALOG } from "../avatarCatalog.gen";
import type { ActivityId, GestureId } from "../avatarCatalog.gen";

/** Schedules the view-side life of a resting avatar: random idle gestures and a yawn when it relaxes. */
export class IdleDirector {
  private nextAt = 0;
  private last: ActivityId = "reposo";
  constructor(private rng: () => number, now: number) { this.nextAt = now + this.delay("reposo"); }

  private delay(activity: ActivityId): number {
    return activity === "relajado" ? 60_000 + this.rng() * 60_000 : 20_000 + this.rng() * 40_000;
  }

  get nextAtMs(): number { return this.nextAt; }

  update(now: number, activity: ActivityId, enabled: boolean): GestureId | null {
    const prev = this.last;
    this.last = activity;
    if (activity !== "reposo" && activity !== "relajado") { this.nextAt = now + this.delay("reposo"); return null; }
    if (!enabled) return null;
    if (prev === "reposo" && activity === "relajado") { this.nextAt = now + this.delay("relajado"); return "bostezo"; }
    if (now < this.nextAt) return null;
    this.nextAt = now + this.delay(activity);
    const list = CATALOG.idleGestures;
    return list[Math.floor(this.rng() * list.length)] as GestureId;
  }
}
