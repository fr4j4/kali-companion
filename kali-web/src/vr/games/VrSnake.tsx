import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Container, Text } from "@react-three/uikit";
import type { SnakeGame } from "../../games/snake/snake-game";
type Point = { x: number; y: number };
import { GameStatus } from "../../games/core/constants/game-status";

type Props = {
  game: SnakeGame;
  onCommand: (cmd: string) => void;
  onMove: (dir: string) => void;
  /** registra la textura para que el host la monte como mesh r3f nativo */
  onTexture?: (tex: THREE.CanvasTexture | null) => void;
};

const BOARD_W = 20;
const TEX = 400; // px de la textura
const CELL = TEX / BOARD_W;

const C = {
  bg: "#02040a", grid: "#0f1c38", head: "#22d3ee", body: "#d946ef",
  food: "#ef4444", border: "#1e3a8a",
};

/**
 * B5: Snake en VR — realtime con CanvasTexture (uikit no aguanta 400 celdas).
 * D-pad uikit para girar; fling del stick derecho opcional.
 */
export function VrSnake({ game, onCommand, onMove, onTexture }: Props) {
  const gl = useThree((s) => s.gl);
  const acc = useRef(0);
  const [tickv, setTickv] = useState(0);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = TEX;
    canvas.height = TEX;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, canvas, ctx: canvas.getContext("2d")! };
  }, []);

  const paint = () => {
    const ctx = texture.ctx;
    const st = game.getState().data as { snake: Point[]; food: Point } | null;
    if (!st) return;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, TEX, TEX);
    // grilla sutil
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < BOARD_W; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, TEX); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(TEX, i * CELL); ctx.stroke();
    }
    // comida
    ctx.fillStyle = C.food;
    ctx.beginPath();
    ctx.arc((st.food.x + 0.5) * CELL, (st.food.y + 0.5) * CELL, CELL * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // snake
    st.snake.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? C.head : C.body;
      ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);
    });
    texture.tex.needsUpdate = true;
  };

  useEffect(() => {
    // arrancar partida
    game.handleAction({ type: "command" as never, data: "start" }, "player");
    paint();
    onTexture?.(texture.tex);
    return () => onTexture?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const st = game.getState();
    if (st.status !== GameStatus.PLAYING) return;
    acc.current += delta;
    const tickMs = (game as unknown as { getTickMs(): number }).getTickMs?.() ?? 140;
    if (acc.current * 1000 >= tickMs) {
      acc.current = 0;
      game.tick();
      paint();
      setTickv((v) => v + 1);
    }
  });

  // fling del stick derecho
  const cooldown = useRef(0);
  useFrame((_, delta) => {
    cooldown.current = Math.max(0, cooldown.current - delta);
    const session = gl.xr.getSession?.();
    if (!session || cooldown.current > 0) return;
    for (const src of session.inputSources) {
      if (src.handedness !== "right" || !src.gamepad) continue;
      const ax = src.gamepad.axes;
      const x = ax[2] ?? ax[0] ?? 0;
      const y = ax[3] ?? ax[1] ?? 0;
      if (Math.abs(x) < 0.6 && Math.abs(y) < 0.6) continue;
      const dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? "RIGHT" : "LEFT") : (y > 0 ? "DOWN" : "UP");
      cooldown.current = 0.25;
      onMove(dir);
      break;
    }
  });

  const st = game.getState();
  const over = st.status === GameStatus.LOST;
  return (
    <Container flexDirection="column" alignItems="center" gap={8} width="100%">
      {/* tablero: mesh con CanvasTexture — no puede ir dentro del Container uikit, el host lo monta aparte */}
      <Text fontSize={10} color="#e2e8f0">puntos: {st.score} · nivel {(game as unknown as { getLevel(): number }).getLevel?.() ?? 1}</Text>
      {over && (
        <Container backgroundColor="#7f1d1d" borderRadius={8} padding={10} onClick={() => onCommand("play_again")}>
          <Text fontSize={12} color="#fecdd3">Fin — {st.score} pts · toca REINICIAR arriba</Text>
        </Container>
      )}
      <DPad onMove={onMove} />
      <Text fontSize={8} color="#475569">d-pad o fling del stick · {tickv > 0 ? "" : "arrancando…"}</Text>
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
    <Container flexDirection="column" alignItems="center" gap={4} marginTop={8}>
      {btn("▲", "UP")}
      <Container flexDirection="row" gap={4}>{btn("◀", "LEFT")}{btn("▼", "DOWN")}{btn("▶", "RIGHT")}</Container>
    </Container>
  );
}
