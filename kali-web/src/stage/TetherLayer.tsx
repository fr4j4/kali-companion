/**
 * stage/TetherLayer.tsx — SVG tether paths between avatar and windows.
 *
 * Renders cubic bezier curves from the avatar center to each open window.
 * Tethers animate with a dash-flow effect and pulse on network-pulse events.
 * Colors are derived from window type (TETHER_COLORS).
 */

import { useEffect, useRef, useState } from "react";
import type { ArtifactWindowData } from "../workspace/types";
import { TETHER_COLORS } from "../workspace/types";
import { computeTetherPath } from "../workspace/windowManager";

interface Props {
  windows: ArtifactWindowData[];
}

interface TetherState {
  id: number;
  path: string;
  color: string;
  pulsing: boolean;
}

export function TetherLayer({ windows }: Props) {
  const [tethers, setTethers] = useState<TetherState[]>([]);
  const rafRef = useRef<number | null>(null);
  // Cache of last-seen positions per window id, so we only re-compute
  // tether paths when a window actually moved (not on every `windows`
  // array identity change).
  const lastPositionsRef = useRef<Map<number, string>>(new Map());

  // Performance (docs/PERFORMANCE.md §0.6): the dash-flow CSS animation
  // forces continuous repaint of the SVG layer, which is expensive on
  // WebKitGTK without GPU compositing. Pause it when there are many
  // tethers or when the low-perf path is active.
  const visibleWindows = windows.filter((w) => !w.closed);
  const visibleCount = visibleWindows.length;
  const dashStatic = visibleCount >= 4 || (typeof document !== "undefined" && document.documentElement.classList.contains("kali-perf-low"));

  // Update tether paths only when window positions actually change.
  useEffect(() => {
    const update = () => {
      const next: TetherState[] = [];
      let changed = false;
      for (const w of visibleWindows) {
        const el = document.querySelector(`[data-window-id="${w.id}"]`) as HTMLElement | null;
        if (!el) continue;
        // Build a signature of position+size to detect real changes.
        const sig = `${w.position.x},${w.position.y},${w.size.width},${w.size.height ?? 0}`;
        const prev = lastPositionsRef.current.get(w.id);
        if (prev === sig) {
          // Position unchanged — reuse existing tether if present.
          const existing = tethers.find((t) => t.id === w.id);
          if (existing) {
            next.push(existing);
            continue;
          }
        }
        changed = true;
        lastPositionsRef.current.set(w.id, sig);
        const path = computeTetherPath(el);
        const color = TETHER_COLORS[w.type] || "#22d3ee";
        next.push({ id: w.id, path, color, pulsing: false });
      }
      // Clean up stale entries from lastPositionsRef.
      const visibleIds = new Set(visibleWindows.map((w) => w.id));
      for (const id of lastPositionsRef.current.keys()) {
        if (!visibleIds.has(id)) lastPositionsRef.current.delete(id);
      }
      if (changed) {
        setTethers(next);
      }
    };
    // Throttle via rAF
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(update);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [windows]);

  // Network pulse event
  useEffect(() => {
    const onPulse = () => {
      setTethers((prev) => prev.map((t) => ({ ...t, pulsing: true })));
      setTimeout(() => {
        setTethers((prev) => prev.map((t) => ({ ...t, pulsing: false })));
      }, 600);
    };
    window.addEventListener("kali:network-pulse", onPulse);
    return () => window.removeEventListener("kali:network-pulse", onPulse);
  }, []);

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 25 }}>
      <defs>
        <linearGradient id="tetherGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="50%" stopColor="var(--accent-dim)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      {tethers.map((t) => (
        <path
          key={t.id}
          d={t.path}
          fill="none"
          stroke={t.color}
          strokeWidth={t.pulsing ? 5 : 2.5}
          strokeDasharray="8 6"
          strokeLinecap="round"
          opacity={t.pulsing ? 1 : 0.45}
          className={dashStatic ? "tether-static" : "tether-flow"}
        />
      ))}
    </svg>
  );
}