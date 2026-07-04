import { useRef } from "react";

export function useSwipeDirection(
  onSwipe: (direction: "UP" | "DOWN" | "LEFT" | "RIGHT") => void,
  threshold = 28,
) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      startRef.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < threshold) return;
      if (absX > absY) {
        onSwipe(dx > 0 ? "RIGHT" : "LEFT");
      } else {
        onSwipe(dy > 0 ? "DOWN" : "UP");
      }
    },
  };
}
