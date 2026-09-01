import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Container, Text } from "@react-three/uikit";
import type { TwentyFortyEightGame, BoardData } from "../../games/twenty-forty-eight/twenty-forty-eight-game";
import { ActionType } from "../../games/core/constants/action-types";
import { GameStatus } from "../../games/core/constants/game-status";

type Props = {
  game: TwentyFortyEightGame;
};

const TILE_COLORS: Record<number, string> = {
  2: "#1e293b", 4: "#334155", 8: "#0ea5e9", 16: "#0284c7", 32: "#6366f1",
  64: "#8b5cf6", 128: "#a78bfa", 256: "#c084fc",
  512: "#f472b6", 1024: "#fb7185", 2048: "#f59e0b",
};
const CELL = 84;

/** B4: 2048 en VR — grilla uikit + fling del stick derecho (cooldown 250ms) + d-pad. */
export function Vr2048({ game }: Props) {
  const gl = useThree((s) => s.gl);
  const cooldown = useRef(0);
  const [grid, setGrid] = useState<BoardData>(() => game.getState().data as BoardData);

  const move = (dir: string) => {
    const st = game.getState();
    if (st.status === GameStatus.WAITING) {
      game.handleAction({ type: "command" as never, data: "start" }, "player");
    }
    game.handleAction({ type: ActionType.MOVE, data: dir }, "player");
    setGrid(game.getState().data as BoardData);
  };

  // fling del stick derecho
  useFrame((_, delta) => {
    cooldown.current = Math.max(0, cooldown.current - delta);
    const session = gl.xr.getSession?.();
    if (!session || cooldown.current > 0) return;
    for (const src of session.inputSources) {
      if (src.handedness !== "right" || !src.gamepad) continue;
      const ax = src.gamepad.axes;
      const x = ax[2] ?? ax[0] ?? 0;
      const y = ax[3] ?? ax[1] ?? 0;
      const TH = 0.7;
      if (Math.abs(x) < TH && Math.abs(y) < TH) continue;
      const dir = Math.abs(x) > Math.abs(y)
        ? (x > 0 ? "right" : "left")
        : (y > 0 ? "down" : "up");
      cooldown.current = 0.25;
      move(dir);
      break;
    }
  });

  const over = (game.getState().data as BoardData)?.over;
  return (
    <Container flexDirection="column" alignItems="center" gap={8} width="100%">
      <Container backgroundColor="#020617" borderRadius={10} padding={10}>
        {(grid?.cells ?? []).map((row, r) => (
          <Container key={r} flexDirection="row" gap={4}>
            {row.map((tile, c) => {
              const v = tile?.value ?? 0;
              return (
                <Container key={c} width={CELL} height={CELL} borderRadius={8} alignItems="center" justifyContent="center"
                  backgroundColor={v ? (TILE_COLORS[v] ?? "#7c3aed") : "#111827"}>
                  {v > 0 && <Text fontSize={v >= 1024 ? 20 : 26} color={v <= 4 ? "#94a3b8" : "#f8fafc"} fontWeight={700}>{v}</Text>}
                </Container>
              );
            })}
          </Container>
        ))}
      </Container>
      {over && <Text fontSize={12} color="#fb7185">Sin movimientos — reiniciar arriba</Text>}
      <DPad onMove={move} />
      <Text fontSize={8} color="#475569">stick derecho = deslizar · d-pad también funciona</Text>
    </Container>
  );
}

function DPad({ onMove }: { onMove: (dir: string) => void }) {
  const btn = (label: string, dir: string) => (
    <Container width={44} height={36} backgroundColor="#1e293b" borderRadius={6} alignItems="center" justifyContent="center"
      hover={{ backgroundColor: "#38bdf8" }} onClick={() => onMove(dir)}>
      <Text fontSize={13} color="#e2e8f0">{label}</Text>
    </Container>
  );
  return (
    <Container flexDirection="column" alignItems="center" gap={4}>
      {btn("▲", "up")}
      <Container flexDirection="row" gap={4}>{btn("◀", "left")}{btn("▼", "down")}{btn("▶", "right")}</Container>
    </Container>
  );
}
