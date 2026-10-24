/**
 * stage/v2/useRelativeTime.ts — "2 s", "3 min", "1 h" since a moment, refreshed slowly.
 *
 * One shared 15 s ticker for every footer on screen instead of a timer per window.
 */

import { useEffect, useState } from "react";
import i18n from "../../lib/i18n";

const listeners = new Set<() => void>();
let timer: number | undefined;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (timer === undefined) timer = window.setInterval(() => listeners.forEach((l) => l()), 15000);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  };
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return i18n.t("v2.ago.seconds", { count: s });
  const m = Math.round(s / 60);
  if (m < 60) return i18n.t("v2.ago.minutes", { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return i18n.t("v2.ago.hours", { count: h });
  return i18n.t("v2.ago.days", { count: Math.round(h / 24) });
}

/** Relative time since `at` (ms), or null. Re-renders every 15 s while mounted. */
export function useRelativeTime(at: number | undefined | null): string | null {
  const [, setTick] = useState(0);
  useEffect(() => (at ? subscribe(() => setTick((n) => n + 1)) : undefined), [at]);
  return at ? formatAgo(Date.now() - at) : null;
}
