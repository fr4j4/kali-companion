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
import { useStage } from "../../stage/StageProvider";
import { hasLLMIntegration } from "../../games/ai/game-llm-provider";
import { gameSessionStore } from "../../games/core/game-session-store";
import { createGameSessionManager, type GameSessionManager } from "../../games/core/game-session-manager";
import { AISlot } from "../../games/ai/ai-slot";
import { PlayerType } from "../../games/core/constants/player-types";
import { Brain, Gamepad2 } from "lucide-react";

export interface GameContent {
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

  const { setSidePanelContent, openSidePanel, setLeftSidePanelContent, openLeftSidePanel } = useSidePanel();
  const wsClient = useGameWS();
  const { systemStatus } = useChat();
  const systemStatusRef = useRef(systemStatus);
  systemStatusRef.current = systemStatus;
  const { connections } = useStage();
  const hasKali = hasLLMIntegration(systemStatus, connections);
  const replaySessionId = parsed.sessionId;

  const initialOpenDoneRef = useRef(false);

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
        aiSlot.setGlobalTimeout(() => systemStatusRef.current?.game_ai_global_timeout_ms ?? 20_000);
        aiSlot.setGameAiConfig(() => ({
          game_connection_id: systemStatusRef.current?.game_connection_id,
          game_model: systemStatusRef.current?.game_model,
          game_temperature: systemStatusRef.current?.game_temperature,
          game_max_tokens: systemStatusRef.current?.game_max_tokens,
        }));
        providers.set(slot.id, aiSlot);
      }
    }

    const manager = createGameSessionManager(game, providers, {
      onStateChange: () => forceRender((v) => v + 1),
      onAIStatusChange: () => forceRender((v) => v + 1),
    });
    managerRef.current = manager;
    setReady(true);

    if (api && windowId != null) {
      const headerOffset = 42; // measured in logical px; body scaling handles winScale
      api.resizeWindow(windowId, {
        width: game.naturalWidth,
        height: game.naturalHeight + headerOffset,
      });
    }

    const shouldOpenGameLog = systemStatusRef.current?.game_log_default_open ?? false;
    const shouldOpenReasoning = systemStatusRef.current?.game_reasoning_default_open ?? false;

    setSidePanelContent({
      icon: <Gamepad2 size={14} />,
      title: "Game Log",
      onClear: () => gameSessionStore.clearSession(game.sessionId),
      content: <GameDebugPanel getSessionId={() => game.sessionId} />,
    });
    if (shouldOpenGameLog && !initialOpenDoneRef.current) {
      openSidePanel();
    }

    setLeftSidePanelContent({
      icon: <Brain size={14} />,
      title: "Reasoning",
      onClear: () => gameSessionStore.clearSession(game.sessionId),
      content: <GameReasoningPanel getSessionId={() => game.sessionId} />,
    });
    if (shouldOpenReasoning && !initialOpenDoneRef.current) {
      openLeftSidePanel();
    }

    initialOpenDoneRef.current = true;

    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
      gameRef.current?.stop();
      gameRef.current = null;
      setReady(false);
      initialOpenDoneRef.current = false;
      setSidePanelContent(null);
      setLeftSidePanelContent(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gameType, wsClient, setSidePanelContent, setLeftSidePanelContent, systemStatus?.game_log_default_open, systemStatus?.game_reasoning_default_open]);

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

  const isMaximized = (api?.windows ?? []).some((w) => w.id === windowId && w.maximized);

  if (mode === "game" && gameType && ready && gameRef.current && managerRef.current) {
    return <GameRenderer game={gameRef.current} manager={managerRef.current} hasKali={hasKali} isMaximized={isMaximized} />;
  }

  if (mode === "saved-games") {
    return <SavedGamesPanel api={api} />;
  }

  if (mode === "saved-game-replay" && replaySessionId) {
    return <SavedGameReplay sessionId={replaySessionId} />;
  }

  return <ToysLaunchpad api={api} />;
}
