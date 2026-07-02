import { useEffect, useRef, useState } from "react";
import type { WorkspaceAPI } from "../../workspace/types";
import { SavedGamesPanel } from "../games/SavedGamesPanel";
import { SavedGameReplay } from "../games/SavedGameReplay";
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
import { useGameWS } from "../../lib/gameWSClient";
import { useChat } from "../../hooks/useChat";
import { hasLLMIntegration } from "../../games/ai/game-llm-provider";
import { gameSessionStore } from "../../games/core/game-session-store";
import { createGameSessionManager, type GameSessionManager } from "../../games/core/game-session-manager";
import { AISlot } from "../../games/ai/ai-slot";
import { PlayerType } from "../../games/core/constants/player-types";
import { Brain, Gamepad2 } from "lucide-react";

interface GameContent {
  mode?: "launchpad" | "game" | "saved-games" | "saved-game-replay";
  gameType?: GameTypeValue;
  sessionId?: string;
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
  const managerRef = useRef<GameSessionManager | null>(null);
  const [ready, setReady] = useState(false);

  const { setSidePanelContent, setLeftSidePanelContent } = useSidePanel();
  const wsClient = useGameWS();
  const { systemStatus } = useChat();
  const hasKali = hasLLMIntegration(systemStatus);
  const replaySessionId = parsed.sessionId;

  const [, forceRender] = useState(0);

  useEffect(() => {
    gameSessionStore.setWSClient(wsClient);
  }, [wsClient]);

  useEffect(() => {
    if (mode !== "game" || !gameType) {
      setSidePanelContent(null);
      setLeftSidePanelContent(null);
      return;
    }

    ensureRegistered();
    const game = GameRegistry.create(gameType as any, { slots: [] });
    gameRef.current = game;

    const providers = new Map();
    for (const slot of game.slots) {
      if (slot.type === PlayerType.AI) {
        const aiSlot = new AISlot(slot.id, wsClient, () => game.sessionId);
        aiSlot.setGlobalTimeout(() => systemStatus?.game_ai_global_timeout_ms ?? 20_000);
        providers.set(slot.id, aiSlot);
      }
    }

    const manager = createGameSessionManager(game, providers, {
      onStateChange: () => forceRender((v) => v + 1),
      onAIStatusChange: () => forceRender((v) => v + 1),
    });
    managerRef.current = manager;
    setReady(true);

    setSidePanelContent({
      icon: <Gamepad2 size={14} />,
      title: "Game Log",
      onClear: () => gameSessionStore.clearSession(game.sessionId),
      content: <GameDebugPanel getSessionId={() => game.sessionId} />,
    });

    setLeftSidePanelContent({
      icon: <Brain size={14} />,
      title: "Reasoning",
      onClear: () => gameSessionStore.clearSession(game.sessionId),
      content: <GameReasoningPanel getSessionId={() => game.sessionId} />,
    });

    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
      gameRef.current?.stop();
      gameRef.current = null;
      setReady(false);
      setSidePanelContent(null);
      setLeftSidePanelContent(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gameType, wsClient, setSidePanelContent, setLeftSidePanelContent, systemStatus?.game_ai_global_timeout_ms]);

  const prevFocusedRef = useRef(false);

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

  if (mode === "game" && gameType && ready && gameRef.current && managerRef.current) {
    return <GameRenderer game={gameRef.current} manager={managerRef.current} hasKali={hasKali} />;
  }

  if (mode === "saved-games") {
    return <SavedGamesPanel api={api} />;
  }

  if (mode === "saved-game-replay" && replaySessionId) {
    return <SavedGameReplay sessionId={replaySessionId} />;
  }

  return <ToysLaunchpad api={api} />;
}
