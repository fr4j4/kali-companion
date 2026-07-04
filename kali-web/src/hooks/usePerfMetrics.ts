import { useEffect, useRef, useState } from "react";
import type { PerformanceProfile } from "../App";
import type { WindowData } from "../workspace/types";

export interface PerfMetrics {
  fps: number;
  worstFrameMs: number;
  memoryMB: number | null;
  windows: number;
  gameWindows: number;
  profile: PerformanceProfile;
}

export function usePerfMetrics(windows: WindowData[], profile: PerformanceProfile): PerfMetrics {
  const liveRef = useRef({ windows, profile });
  liveRef.current = { windows, profile };
  const [metrics, setMetrics] = useState<PerfMetrics>({
    fps: 0,
    worstFrameMs: 0,
    memoryMB: null,
    windows: 0,
    gameWindows: 0,
    profile,
  });

  useEffect(() => {
    let rafId = 0;
    let frames = 0;
    let worstFrameMs = 0;
    let lastFrame = performance.now();
    let lastSample = lastFrame;
    let stopped = false;

    const readMemory = () => {
      const perf = performance as Performance & { memory?: { usedJSHeapSize?: number } };
      return perf.memory?.usedJSHeapSize ? Math.round(perf.memory.usedJSHeapSize / 1024 / 1024) : null;
    };

    const tick = (now: number) => {
      if (stopped) return;
      const frameMs = now - lastFrame;
      lastFrame = now;
      frames += 1;
      worstFrameMs = Math.max(worstFrameMs, frameMs);

      if (now - lastSample >= 1000) {
        const { windows: currentWindows, profile: currentProfile } = liveRef.current;
        const visibleWindows = currentWindows.filter((w) => !w.closed);
        setMetrics({
          fps: Math.round((frames * 1000) / (now - lastSample)),
          worstFrameMs: Math.round(worstFrameMs),
          memoryMB: readMemory(),
          windows: visibleWindows.length,
          gameWindows: visibleWindows.filter((w) => w.type === "game").length,
          profile: currentProfile,
        });
        frames = 0;
        worstFrameMs = 0;
        lastSample = now;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return metrics;
}
