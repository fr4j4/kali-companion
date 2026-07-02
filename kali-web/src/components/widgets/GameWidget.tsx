import { useEffect, useRef, useState } from "react";
import type { WorkspaceAPI } from "../../workspace/types";
import { ToysLaunchpad } from "../games/ToysLaunchpad";
import { GameRenderer } from "../games/GameRenderer";
import { GameRegistry } from "../../games/core/game-registry";
import { GameStatus } from "../../games/core/constants/game-status";
import { GameType, type GameTypeValue } from "../../games/core/constants/game-types";
import type { BaseGame } from "../../games/core/base-game";
import { registerGames } from "../../games/register-games";
import { GameDebugPanel } from "../games/GameDebugPanel";
import { GameReasoningPanel } from "../games/GameReasoningPanel";
import { useSidePanel } from "../../stage/SidePanelContext";
import { useChat } from "../../hooks/useChat";
import { Brain, Gamepad2 } from "lucide-react";

interface GameContent {
  mode?: "launchpad" | "game";
  gameType?: GameTypeValue;
}

interface Props {
  content?: unknown;
  api?: WorkspaceAPI;
  windowId?: number;
}

function ensureRegistered() {
  if (!GameRegistry.isRegistered(GameType.SNAKE)) {
    registerGames();
  }
}

export function GameWidget({ content, api, windowId }: Props) {
  const parsed = (content ?? {}) as GameContent;
  const mode = parsed.mode ?? "launchpad";
  const gameType = parsed.gameType;

  const gameRef = useRef<BaseGame | null>(null);
  const [ready, setReady] = useState(false);

  const { setSidePanelContent, setLeftSidePanelContent } = useSidePanel();
  const { wsClient } = useChat();

  useEffect(() => {
    if (mode !== "game" || !gameType) {
      setSidePanelContent(null);
      setLeftSidePanelContent(null);
      return;
    }

    ensureRegistered();
    const game = GameRegistry.create(gameType as any, { slots: [] });
    game.start();
    gameRef.current = game;
    setReady(true);

    setSidePanelContent({
      icon: <Gamepad2 size={14} />,
      title: "Game Log",
      onClear: () => game.aiLog.clearSession(game.sessionId),
      content: <GameDebugPanel getSessionId={() => game.sessionId} />,
    });

    setLeftSidePanelContent({
      icon: <Brain size={14} />,
      title: "Reasoning",
      onClear: () => game.aiLog.clearSession(game.sessionId),
      content: <GameReasoningPanel sessionId={game.sessionId} wsClient={wsClient} />,
    });

    return () => {
      gameRef.current = null;
      setReady(false);
      setSidePanelContent(null);
      setLeftSidePanelContent(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gameType, wsClient, setSidePanelContent, setLeftSidePanelContent]);

  const prevFocusedRef = useRef(false);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const isFocused = (api?.windows ?? []).some((w) => w.id === windowId && w.focused && !w.closed);
    const game = gameRef.current;

    if (prevFocusedRef.current && !isFocused && game?.getStatus() === GameStatus.PLAYING) {
      if (game.type === GameType.SNAKE) {
        game.pause();
        forceRender((v) => v + 1);
      }
    }

    prevFocusedRef.current = isFocused;
  });

  if (mode === "game" && gameType && ready && gameRef.current) {
    return <GameRenderer game={gameRef.current} />;
  }

  return <ToysLaunchpad api={api} />;
}
