import { useRef, useCallback } from "react";

export function useTimer() {
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback((cb: () => void, ms: number) => {
    stop();
    ref.current = setInterval(cb, ms);
  }, []);

  const stop = useCallback(() => {
    if (ref.current !== null) {
      clearInterval(ref.current);
      ref.current = null;
    }
  }, []);

  return { start, stop };
}
