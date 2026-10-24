/**
 * lib/motion.ts — Whether the canvas may animate right now.
 *
 * The performance profile (and the automatic low-performance flag on WebKitGTK or small CPUs) turns
 * every canvas animation off; reduced motion keeps only fades. CSS animations are switched off in
 * one block of canvas-v2.css; this helper covers the few made from script (FLIP mode changes).
 */

export type MotionLevel = "full" | "fade" | "none";

export function motionLevel(): MotionLevel {
  if (typeof document === "undefined") return "none";
  const root = document.documentElement;
  if (root.getAttribute("data-perf-profile") === "performance" || root.classList.contains("kali-perf-low")) return "none";
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "fade";
  return "full";
}

export const motionAllowed = () => motionLevel() === "full";

/** Duration of a zone change (FLIP) in ms. */
export const ZONE_MS = 220;
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Animate an element from where it was (`from`) to where it is now (`to`) with a transform, so
 * the layout is computed once and only the compositor moves it. No-op without full motion.
 */
export function flip(el: HTMLElement, from: Box, to: Box, ms = ZONE_MS): void {
  if (!motionAllowed() || typeof el.animate !== "function") return;
  if (to.w <= 0 || to.h <= 0) return;
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const sx = from.w / to.w;
  const sy = from.h / to.h;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
  el.animate(
    [
      { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: "0 0", transform: "none" },
    ],
    { duration: ms, easing: EASE_OUT },
  );
}
