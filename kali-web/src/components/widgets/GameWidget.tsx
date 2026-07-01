import { useEffect, useRef, useState } from "react";
import type { WorkspaceAPI } from "../../workspace/types";
import { ToysLaunchpad } from "../games/ToysLaunchpad";
import { GameRenderer } from "../games/GameRenderer";
import type { GameTypeValue } from "../../games/core/constants/game-types";
import { GameRegistry } from "../../games/core/game-registry";
import { registerGames } from "../../games/register-games";

interface GameContent {
  mode?: "launchpad" | "game";
  gameType?: GameTypeValue;
}

interface Props {
  content?: unknown;
  api?: WorkspaceAPI;
}

let registered = false;
function ensureRegistered() {
  if (!registered) {
    registerGames();
    registered = true;
  }
}

export function GameWidget({ content, api }: Props) {
  const parsed = (content ?? {}) as GameContent;
  const mode = parsed.mode ?? "launchpad";
  const gameType = parsed.gameType;

  const gameRef = useRef<ReturnType<typeof GameRegistry.create> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mode !== "game" || !gameType) return;
    ensureRegistered();
    const game = GameRegistry.create(gameType as any, { slots: [] });
    game.start();
    gameRef.current = game;
    setReady(true);
    return () => {
      gameRef.current = null;
      setReady(false);
    };
  }, [mode, gameType]);

  if (mode === "game" && gameType && ready && gameRef.current) {
    return <GameRenderer game={gameRef.current} />;
  }

  return <ToysLaunchpad api={api} />;
}
