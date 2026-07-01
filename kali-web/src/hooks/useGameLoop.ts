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
    let rafId: number;

    function loop(now: number) {
      const status = game.getStatus();

      if (status === GameStatus.PLAYING) {
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
        if (status === GameStatus.PLAYING) {
          lastTick = now;
        }
      }

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [game]);
}
