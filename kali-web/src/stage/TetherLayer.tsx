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

  // Update tether paths on window position changes
  useEffect(() => {
    const update = () => {
      const next: TetherState[] = [];
      for (const w of windows) {
        if (w.closed) continue;
        const el = document.querySelector(`[data-window-id="${w.id}"]`) as HTMLElement | null;
        if (!el) continue;
        const path = computeTetherPath(el);
        const color = TETHER_COLORS[w.type] || "#22d3ee";
        next.push({ id: w.id, path, color, pulsing: false });
      }
      setTethers(next);
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
          style={{
            transition: "opacity 0.3s, stroke-width 0.3s, filter 0.3s",
            filter: t.pulsing ? "drop-shadow(0 0 10px rgba(34,211,238,0.9))" : "none",
            animation: "dashFlow 20s linear infinite",
          }}
        />
      ))}
    </svg>
  );
}