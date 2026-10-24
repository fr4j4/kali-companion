import type { AvatarRig } from "./rig";

/**
 * Drives a rig with the least wakeups possible: rAF while animating, a timer while only ambient motion
 * or a pending blink remains, nothing while the page is hidden.
 */
export class RigLoop {
  private raf = 0;
  private timer = 0;
  private running = false;
  private onVisibility = () => { if (document.hidden) this.pause(); else if (this.running) this.schedule(0); };

  constructor(private rig: AvatarRig, private clock: () => number = () => Date.now()) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.rig.setKick(() => { if (this.running && !document.hidden) this.schedule(0); });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.rig.setKick(null);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.pause();
  }

  private pause(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.raf = 0;
    this.timer = 0;
  }

  private schedule(delay: number): void {
    this.pause();
    if (delay > 24) this.timer = window.setTimeout(() => this.schedule(0), delay - 8);
    else this.raf = requestAnimationFrame(this.step);
  }

  private step = (): void => {
    this.raf = 0;
    const now = this.clock();
    this.rig.tick(now);
    this.schedule(this.rig.nextWakeMs(now));
  };
}
