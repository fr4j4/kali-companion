import { useEffect, useRef, useState } from "react";
import type { SnakeGame } from "../../games/snake/snake-game";
import { GameStatus } from "../../games/core/constants/game-status";
import { ActionType, GameCommand } from "../../games/core/constants/action-types";

const CELL = 24;
const BOARD_W = 20;
const BOARD_H = 20;
const CANVAS_W = BOARD_W * CELL;
const CANVAS_H = BOARD_H * CELL;

const PALETTE = {
  bg: "#0f380f",
  grid: "#1a4a1a",
  head: "#4ade80",
  headDark: "#22c55e",
  body: "#2ecc71",
  bodyDark: "#27ae60",
  bodyInner: "#22a854",
  apple: "#ef4444",
  appleLight: "#f87171",
  appleStem: "#65a30d",
  appleLeaf: "#4d7c0f",
  eyeWhite: "#f0fdf4",
  pupil: "#0f380f",
  border: "#166534",
  borderLight: "#22c55e",
};

interface Props {
  game: SnakeGame;
}

function send(game: SnakeGame, command: string) {
  game.handleAction({ type: ActionType.COMMAND, data: command }, "player");
}

function drawPixelApple(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const s = CELL;
  const r = 9;

  ctx.fillStyle = PALETTE.apple;
  ctx.beginPath();
  ctx.arc(cx + s / 2, cy + s / 2 + 1, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.appleLight;
  ctx.beginPath();
  ctx.arc(cx + s / 2 - 3, cy + s / 2 - 2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PALETTE.appleStem;
  ctx.fillRect(cx + s / 2 - 1, cy + 3, 3, 5);

  ctx.fillStyle = PALETTE.appleLeaf;
  ctx.fillRect(cx + s / 2 + 2, cy + 3, 5, 3);
}

function drawSnakeHead(ctx: CanvasRenderingContext2D, x: number, y: number, dir: string) {
  ctx.fillStyle = PALETTE.headDark;
  ctx.fillRect(x, y, CELL, CELL);

  ctx.fillStyle = PALETTE.head;
  ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);

  const ex = x + (dir === "LEFT" ? 4 : dir === "RIGHT" ? 14 : 6);
  const ey = y + (dir === "UP" ? 4 : dir === "DOWN" ? 14 : 6);
  const ew = 5;
  const eh = 5;

  ctx.fillStyle = PALETTE.eyeWhite;
  ctx.fillRect(ex, ey, ew, eh);
  ctx.fillRect(
    x + (dir === "LEFT" ? 14 : dir === "RIGHT" ? 4 : 12),
    ey, ew, eh,
  );

  ctx.fillStyle = PALETTE.pupil;
  ctx.fillRect(ex + 1, ey + 1, 3, 3);
  ctx.fillRect(
    x + (dir === "LEFT" ? 15 : dir === "RIGHT" ? 5 : 13),
    ey + 1, 3, 3,
  );
}

function drawSnakeBody(ctx: CanvasRenderingContext2D, x: number, y: number, idx: number) {
  ctx.fillStyle = idx % 2 === 0 ? PALETTE.body : PALETTE.bodyDark;
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);

  ctx.fillStyle = PALETTE.bodyInner;
  ctx.fillRect(x + 5, y + 5, CELL - 10, CELL - 10);
}

interface DrawState {
  snake: { x: number; y: number }[];
  food: { x: number; y: number };
  direction: string;
}

export function SnakeView({ game }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const TICK_MS = (game.constructor as typeof SnakeGame).TICK_INTERVAL_MS;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    let lastTick = performance.now();
    let lastVersion = -1;
    let rafId: number;

    function draw() {
      if (!ctx || !canvas) return;
      const state = game.getState();
      const data = state.data as DrawState | null;

      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.strokeStyle = PALETTE.borderLight;
      ctx.lineWidth = 3;
      ctx.strokeRect(1, 1, CANVAS_W - 2, CANVAS_H - 2);

      ctx.strokeStyle = PALETTE.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(4, 4, CANVAS_W - 8, CANVAS_H - 8);

      ctx.strokeStyle = PALETTE.grid;
      ctx.lineWidth = 1;
      for (let x = 0; x <= BOARD_W; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL + 0.5, 0);
        ctx.lineTo(x * CELL + 0.5, CANVAS_H);
        ctx.stroke();
      }
      for (let y = 0; y <= BOARD_H; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL + 0.5);
        ctx.lineTo(CANVAS_W, y * CELL + 0.5);
        ctx.stroke();
      }

      if (data) {
        data.snake.forEach((seg, i) => {
          const px = seg.x * CELL;
          const py = seg.y * CELL;
          if (i === 0) {
            drawSnakeHead(ctx, px, py, data.direction);
          } else {
            drawSnakeBody(ctx, px, py, i);
          }
        });

        drawPixelApple(ctx, data.food.x * CELL, data.food.y * CELL);
      }
    }

    function loop(now: number) {
      if (game.getStatus() === GameStatus.PLAYING) {
        if (now - lastTick >= TICK_MS) {
          game.tick();
          lastTick = now;
        }
      }

      draw();

      if (game.version !== lastVersion) {
        lastVersion = game.version;
        forceRender((v) => v + 1);
      }

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [game]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const dir: Record<string, string> = {
        ArrowUp: "UP", ArrowDown: "DOWN",
        ArrowLeft: "LEFT", ArrowRight: "RIGHT",
      };

      const status = game.getStatus();

      if (status === GameStatus.WAITING) {
        if (e.key === "Enter") {
          e.preventDefault();
          send(game, GameCommand.START);
        }
        return;
      }

      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        e.preventDefault();
        if (status === GameStatus.PLAYING) {
          send(game, GameCommand.PAUSE);
        } else if (status === GameStatus.PAUSED) {
          send(game, GameCommand.RESUME);
        }
        return;
      }

      if (status === GameStatus.LOST) {
        if (e.key === "Enter") {
          e.preventDefault();
          send(game, GameCommand.PLAY_AGAIN);
        }
        return;
      }

      if (status === GameStatus.PAUSED) return;

      const d = dir[e.key];
      if (d) {
        e.preventDefault();
        game.handleAction({ type: ActionType.MOVE, data: d }, "player");
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [game]);

  const status = game.getStatus();
  const state = game.getState();

  const pixelFont = { fontFamily: "'Press Start 2P', monospace" };

  return (
    <div className="flex flex-col items-center justify-center flex-1 bg-[#0a0a0a] relative py-4">
      <div className="p-2 bg-[#0f380f] rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.15)]">
        <canvas
          ref={canvasRef}
          className="rounded-lg block"
          style={{ width: CANVAS_W, height: CANVAS_H }}
        />

        <div className="flex items-center justify-between px-1 pt-2">
          <span
            className="text-[10px] tracking-wider"
            style={{ ...pixelFont, color: PALETTE.head }}
          >
            SCORE: {state.score}
          </span>
          <span
            className="text-[8px]"
            style={{ ...pixelFont, color: PALETTE.grid }}
          >
            {state.score >= 100 ? "PRO" : "SNAKE"}
          </span>
        </div>
      </div>

      {status === GameStatus.WAITING && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f380f]/85 rounded-xl z-10 backdrop-blur-[2px]">
          <span className="text-5xl mb-3 filter drop-shadow-[0_0_8px_rgba(74,222,128,0.5)]">{'\u{1F40D}'}</span>
          <h2 className="text-xl mb-1 tracking-wider" style={{ ...pixelFont, color: PALETTE.head }}>
            SNAKE
          </h2>
          <p className="text-xs mb-6" style={{ ...pixelFont, color: PALETTE.grid }}>
            Eat. Grow. Survive.
          </p>
          <button
            onClick={() => send(game, GameCommand.START)}
            className="px-5 py-2 rounded-lg transition-colors text-xs tracking-wider hover:brightness-110"
            style={{ ...pixelFont, backgroundColor: PALETTE.headDark, color: PALETTE.bg }}
          >
            START
          </button>
          <p className="text-[9px] mt-3" style={{ ...pixelFont, color: PALETTE.grid }}>
            or press ENTER
          </p>
        </div>
      )}

      {status === GameStatus.PAUSED && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 rounded-xl z-10 backdrop-blur-[2px]">
          <h2 className="text-base mb-6 tracking-wider" style={{ ...pixelFont, color: PALETTE.head }}>
            PAUSED
          </h2>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => send(game, GameCommand.RESUME)}
              className="px-5 py-2 rounded-lg transition-colors text-xs tracking-wider hover:brightness-110"
              style={{ ...pixelFont, backgroundColor: PALETTE.headDark, color: PALETTE.bg }}
            >
              RESUME
            </button>
            <button
              onClick={() => send(game, GameCommand.RESTART)}
              className="px-5 py-2 rounded-lg transition-colors text-xs tracking-wider hover:brightness-110"
              style={{ ...pixelFont, backgroundColor: "#1a4a1a", color: PALETTE.head }}
            >
              RESTART
            </button>
            <button
              onClick={() => send(game, GameCommand.GIVE_UP)}
              className="px-5 py-2 rounded-lg transition-colors text-xs tracking-wider hover:brightness-110"
              style={{ ...pixelFont, color: PALETTE.appleLight, backgroundColor: "#3a1a1a" }}
            >
              QUIT
            </button>
          </div>
          <p className="text-[9px] mt-4" style={{ ...pixelFont, color: PALETTE.grid }}>
            ESC to resume
          </p>
        </div>
      )}

      {status === GameStatus.LOST && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f380f]/85 rounded-xl z-10 backdrop-blur-[2px]">
          <h2 className="text-lg mb-1 tracking-wider" style={{ ...pixelFont, color: PALETTE.apple }}>
            GAME OVER
          </h2>
          <p className="text-xs mb-4" style={{ ...pixelFont, color: PALETTE.head }}>
            SCORE: {state.score}
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => send(game, GameCommand.PLAY_AGAIN)}
              className="px-5 py-2 rounded-lg transition-colors text-xs tracking-wider hover:brightness-110"
              style={{ ...pixelFont, backgroundColor: PALETTE.headDark, color: PALETTE.bg }}
            >
              PLAY AGAIN
            </button>
            <button
              onClick={() => send(game, GameCommand.GIVE_UP)}
              className="px-5 py-2 rounded-lg transition-colors text-xs tracking-wider hover:brightness-110"
              style={{ ...pixelFont, color: PALETTE.head, backgroundColor: "#1a4a1a" }}
            >
              QUIT
            </button>
          </div>
          <p className="text-[9px] mt-4" style={{ ...pixelFont, color: PALETTE.grid }}>
            ENTER to retry
          </p>
        </div>
      )}
    </div>
  );
}
