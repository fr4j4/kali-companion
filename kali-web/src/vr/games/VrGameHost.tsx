import { useEffect, useMemo, useState } from "react";
import { Container, Text } from "@react-three/uikit";
import { GameRegistry } from "../../games/core/game-registry";
import { registerGames } from "../../games/register-games";
import { GameStatus } from "../../games/core/constants/game-status";
import type { GameTypeValue } from "../../games/core/constants/game-types";
import type { BaseGame } from "../../games/core/base-game";
import { VrGameLauncher } from "./VrGameLauncher";
import { VrTicTacToe } from "./VrTicTacToe";
import { Vr2048 } from "./Vr2048";
import { VrSnake } from "./VrSnake";

export type VrGameContent = {
  mode?: "launchpad" | "game";
  gameType?: GameTypeValue;
};

function ensureRegistered() {
  if (!GameRegistry.isRegistered("snake" as GameTypeValue)) registerGames();
}

type Props = {
  ev: { id: string; content: string | null; title: string; windowType: string };
  /** actualiza el artefacto (para cambiar mode/gameType desde el launcher) */
  setGameContent: (content: VrGameContent) => void;
};

/**
 * B1: host de juegos en VR. Instancia la clase del juego (modelo puro reutilizado
 * del canvas 2D) y enruta la vista VR correspondiente. HUD con score/estado.
 */
export function VrGameHost({ ev, setGameContent }: Props) {
  const parsed = useMemo(() => {
    try { return (JSON.parse(ev.content ?? "{}") ?? {}) as VrGameContent; } catch { return {} as VrGameContent; }
  }, [ev.content]);
  const mode = parsed.mode ?? "launchpad";
  const gameType = parsed.gameType;

  if (mode !== "game" || !gameType) {
    return <VrGameLauncher onLaunch={(gt) => setGameContent({ mode: "game", gameType: gt })} />;
  }
  return <VrGameView gameType={gameType} onExit={() => setGameContent({ mode: "launchpad" })} />;
}

function VrGameView({ gameType, onExit }: { gameType: GameTypeValue; onExit: () => void }) {
  const game = useMemo<BaseGame>(() => {
    ensureRegistered();
    const g = GameRegistry.create(gameType, { slots: [] });
    g.start();
    return g;
  }, [gameType]);

  const [, bump] = useState(0);
  const bumpIt = () => bump((v) => v + 1);
  useEffect(() => () => { /* cleanup único por gameType */ }, [gameType]);

  const status = game.getState().status;
  const score = game.getState().score;

  const send = (action: Parameters<BaseGame["handleAction"]>[0]) => {
    game.handleAction(action, "player");
    bumpIt();
  };

  const StatusBadge = () => {
    const label = status === GameStatus.WAITING ? "esperando" : status === GameStatus.PLAYING ? "jugando" : status === GameStatus.PAUSED ? "pausa" : status === GameStatus.WON || status === GameStatus.LOST ? "fin" : status;
    return <Text fontSize={10} color={status === GameStatus.PLAYING ? "#22c55e" : status === GameStatus.PAUSED ? "#fbbf24" : "#94a3b8"}>{label}</Text>;
  };

  return (
    <Container flexDirection="column" gap={6}>
      <Container flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
        <Container flexDirection="row" gap={6} alignItems="center">
          <Text fontSize={11} color="#f43f5e" fontWeight={700}>{gameType}</Text>
          <StatusBadge />
          <Text fontSize={10} color="#e2e8f0">puntos: {score}</Text>
        </Container>
        <Container flexDirection="row" gap={4}>
          <Container backgroundColor="#1e293b" borderRadius={6} padding={6} hover={{ backgroundColor: "#334155" }} onClick={() => { game.restart(); bumpIt(); }}>
            <Text fontSize={10} color="#38bdf8">reiniciar</Text>
          </Container>
          <Container backgroundColor="#1e293b" borderRadius={6} padding={6} hover={{ backgroundColor: "#334155" }} onClick={onExit}>
            <Text fontSize={10} color="#94a3b8">salir</Text>
          </Container>
        </Container>
      </Container>
      {gameType === "tictactoe" && <VrTicTacToe game={game as never} onChanged={() => bump((v) => v + 1)} />}
      {gameType === "2048" && <Vr2048 game={game as never} />}
      {gameType === "snake" && <VrSnake game={game as never} onCommand={(cmd) => send({ type: "command" as never, data: cmd })} onMove={(dir) => send({ type: "move" as never, data: dir })} />}
    </Container>
  );
}
