import { useEffect, useRef } from "react";
import type { BaseGame } from "../games/core/base-game";
import type { GameStatusValue } from "../games/core/constants/game-status";
import { GameStatus } from "../games/core/constants/game-status";

export function useGameLoop(
  game: BaseGame,
  tickMs: number,
  onFrame: (interp: number) => void,
  onStatusChange: (status: GameStatusValue) => void,
): void {
  const onFrameRef = useRef(onFrame);
  const onStatusChangeRef = useRef(onStatusChange);
  const tickMsRef = useRef(tickMs);
  onFrameRef.current = onFrame;
  onStatusChangeRef.current = onStatusChange;
  tickMsRef.current = tickMs;

  useEffect(() => {
    let lastTick = performance.now();
    let lastStatus = game.getStatus();
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const clearScheduled = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    function loop(now: number) {
      if (stopped) return;
      const status = game.getStatus();
      const visible = document.visibilityState !== "hidden";

      if (status === GameStatus.PLAYING && visible) {
        if (now - lastTick >= tickMsRef.current) {
          game.tick();
          lastTick = now;
        }
        onFrameRef.current(Math.min((now - lastTick) / tickMsRef.current, 1));
      } else {
        onFrameRef.current(1);
      }

      if (status !== lastStatus) {
        lastStatus = status;
        onStatusChangeRef.current(status);
        if (status === GameStatus.PLAYING && visible) {
          lastTick = now;
        }
      }

      clearScheduled();
      if (status === GameStatus.PLAYING && visible) {
        rafId = requestAnimationFrame(loop);
      } else {
        timeoutId = setTimeout(() => loop(performance.now()), 200);
      }
    }

    rafId = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      clearScheduled();
    };
  }, [game]);
}
