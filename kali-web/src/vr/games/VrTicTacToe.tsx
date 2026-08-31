import { useEffect, useState } from "react";
import { Container, Text } from "@react-three/uikit";
import { SlotId } from "../../games/core/constants/player-types";
import { TicTacToeCPUPlayer } from "../../games/tic-tac-toe/tic-tac-toe-cpu";
import type { TicTacToeGame, TicTacToeData } from "../../games/tic-tac-toe/tic-tac-toe-game";
import { GameStatus } from "../../games/core/constants/game-status";
import { ActionType } from "../../games/core/constants/action-types";

type Props = { game: TicTacToeGame; onChanged: () => void };

const CELL = 92;
const MARK_COLOR: Record<string, string> = { X: "#38bdf8", O: "#f472b6" };

/** B3: TicTacToe en VR — grilla uikit 3x3, tap directo en celda, CPU local opcional. */
export function VrTicTacToe({ game, onChanged }: Props) {
  const [cpuTurn, setCpuTurn] = useState(false);
  const data = game.getState().data as TicTacToeData;
  const status = game.getState().status;

  const play = (row: number, col: number) => {
    if (status !== GameStatus.PLAYING && status !== GameStatus.WAITING) return;
    game.handleAction({ type: ActionType.MOVE, data: { row, col } }, SlotId.PLAYER);
    onChanged();
    setCpuTurn(true);
  };

  // CPU local: cuando le toca al oponente, decide y juega (fuera del render)
  useEffect(() => {
    if (!cpuTurn) return;
    setCpuTurn(false);
    if (game.getState().status !== GameStatus.PLAYING) return;
    new TicTacToeCPUPlayer("medium").decide(game.getState()).then((action) => {
      game.handleAction(action, SlotId.OPPONENT);
      onChanged();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpuTurn]);

  if (status === GameStatus.WAITING) {
    // primera vez: comenzar
    game.handleAction({ type: "command" as never, data: "start" }, SlotId.PLAYER);
  }

  const finished = status === GameStatus.WON || status === GameStatus.LOST || status === GameStatus.DRAW;
  return (
    <Container flexDirection="column" alignItems="center" gap={8} width="100%">
      <Container backgroundColor="#020617" borderRadius={10} padding={10}>
        {[0, 1, 2].map((r) => (
          <Container key={r} flexDirection="row" gap={4}>
            {[0, 1, 2].map((c) => {
              const mark = data.board[r][c];
              const inWin = game.getState().data !== null; // línea ganadora opcional
              return (
                <Container
                  key={c}
                  width={CELL}
                  height={CELL}
                  backgroundColor={mark ? "#0f172a" : "#1e293b"}
                  borderRadius={8}
                  alignItems="center"
                  justifyContent="center"
                  borderWidth={1}
                  borderColor={inWin ? "#334155" : "#334155"}
                  hover={mark ? undefined : { backgroundColor: "#38bdf8", opacity: 0.3 }}
                  onClick={mark ? undefined : () => play(r, c)}
                >
                  <Text fontSize={30} color={mark ? MARK_COLOR[mark] : "transparent"} fontWeight={700}>{mark ?? ""}</Text>
                </Container>
              );
            })}
          </Container>
        ))}
      </Container>
      {finished && (
        <Text fontSize={12} color={status === GameStatus.WON ? "#22c55e" : status === GameStatus.DRAW ? "#fbbf24" : "#fb7185"}>
          {status === GameStatus.WON ? "¡Ganaste!" : status === GameStatus.DRAW ? "Empate" : "Ganó el oponente"}
        </Text>
      )}
      <Text fontSize={8} color="#475569">toca una celda con el trigger · juegas con X</Text>
    </Container>
  );
}
