import { useCallback, useEffect, useRef, useState } from "react";
import { useSnakeI18n } from "../../games/snake/snake-i18n";

const ABANDONED_DELAY_MS = 1500;
import { SnakeGame } from "../../games/snake/snake-game";
import { GameStatus } from "../../games/core/constants/game-status";
import type { GameStatusValue } from "../../games/core/constants/game-status";
import { ActionType, GameCommand } from "../../games/core/constants/action-types";
import { useGameLoop } from "../../hooks/useGameLoop";
import { useGameViewport } from "./useGameViewport";
import { GameButton, GameMobileActionBar, GamePauseScreen, GameResultScreen, GameTitleScreen, TouchDPad } from "./GameUI";
import { computeGameOffsets, computeGameScale } from "./gameViewportSizing";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useGameKeyboard } from "../../hooks/useGameKeyboard";
import { useSwipeDirection } from "./useSwipeDirection";

const CELL = 24;
const BOARD_W = 20;
const BOARD_H = 20;
const CANVAS_W = BOARD_W * CELL;
const CANVAS_H = BOARD_H * CELL;

const PALETTE = {
  bg: "#02040a",
  grid: "#0f1c38",
  gridGlow: "rgba(56, 189, 248, 0.08)",
  head: "#22d3ee",
  headDark: "#0ea5e9",
  headGlow: "rgba(34, 211, 238, 0.45)",
  body: "#d946ef",
  bodyDark: "#c026d3",
  bodyInner: "#701a75",
  bodyGlow: "rgba(217, 70, 239, 0.45)",
  apple: "#ef4444",
  appleLight: "#f87171",
  appleStem: "#a3e635",
  appleLeaf: "#84cc16",
  appleGlow: "rgba(239, 68, 68, 0.55)",
  eyeWhite: "#ffffff",
  pupil: "#020617",
  border: "#2563eb",
  borderLight: "#38bdf8",
  silhouette: "rgba(0, 0, 0, 0.45)",
  platform: "#050a14",
  platformBorder: "#1e3a8a",
  buttonText: "#020617",
  buttonAltText: "#f0f9ff",
};

interface Props {
  game: SnakeGame;
  isMaximized?: boolean;
  focused?: boolean;
}

function send(game: SnakeGame, command: string) {
  game.handleAction({ type: ActionType.COMMAND, data: command }, "player");
}

function withGlow(ctx: CanvasRenderingContext2D, color: string, blur: number, fn: () => void) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.save();
  ctx.fillStyle = PALETTE.silhouette;
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r);
  ctx.fill();
  ctx.restore();
}

function drawPixelApple(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const s = CELL;
  const r = 9;

  withGlow(ctx, PALETTE.appleGlow, 22, () => {
    ctx.fillStyle = PALETTE.apple;
    ctx.beginPath();
    ctx.arc(cx + s / 2, cy + s / 2 + 1, r, 0, Math.PI * 2);
    ctx.fill();
  });

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
  const r = 6;

  drawSilhouette(ctx, x, y, CELL, CELL, r);

  withGlow(ctx, PALETTE.headGlow, 20, () => {
    ctx.fillStyle = PALETTE.headDark;
    ctx.beginPath();
    ctx.roundRect(x, y, CELL, CELL, r);
    ctx.fill();

    ctx.fillStyle = PALETTE.head;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, CELL - 4, CELL - 4, r - 2);
    ctx.fill();
  });

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
  const r = 5;
  drawSilhouette(ctx, x + 1, y + 1, CELL - 2, CELL - 2, r);
  withGlow(ctx, PALETTE.bodyGlow, 16, () => {
    ctx.fillStyle = idx % 2 === 0 ? PALETTE.body : PALETTE.bodyDark;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, CELL - 2, CELL - 2, r);
    ctx.fill();

    ctx.fillStyle = PALETTE.bodyInner;
    ctx.beginPath();
    ctx.roundRect(x + 5, y + 5, CELL - 10, CELL - 10, r - 2);
    ctx.fill();
  });
}

interface Point {
  x: number;
  y: number;
}

interface DrawState {
  snake: Point[];
  food: Point;
  direction: string;
  level: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function SnakeView({ game, isMaximized, focused = true }: Props) {
  const $ = useSnakeI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreSpanRef = useRef<HTMLSpanElement>(null);
  const levelSpanRef = useRef<HTMLSpanElement>(null);
  const [statusVersion, setStatusVersion] = useState(0);
  void statusVersion;
  const statusRef = useRef<GameStatusValue>(game.getStatus());
  const lastScoreRef = useRef(-1);
  const lastLevelRef = useRef(-1);

  const { hasCoarsePointer, isMobile } = useBreakpoint();
  const viewport = useGameViewport(containerRef, isMaximized);
  const scale = computeGameScale({
    naturalWidth: game.naturalWidth,
    naturalHeight: game.naturalHeight,
    containerWidth: viewport.width,
    containerHeight: viewport.height,
    isMobile,
  });
  const offsets = computeGameOffsets(game.naturalWidth, game.naturalHeight, scale, viewport.width, viewport.height);
  const sendDirection = useCallback((direction: "UP" | "DOWN" | "LEFT" | "RIGHT") => {
    if (game.getStatus() !== GameStatus.PLAYING) return;
    game.handleAction({ type: ActionType.MOVE, data: direction }, "player");
  }, [game]);
  const swipeHandlers = useSwipeDirection(sendDirection);

  const drawFrame = useCallback(
    (interp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = viewport.dpr;

      const targetW = Math.max(1, Math.round(CANVAS_W * dpr));
      const targetH = Math.max(1, Math.round(CANVAS_H * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${CANVAS_W}px`;
        canvas.style.height = `${CANVAS_H}px`;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const state = game.getState();
      const data = state.data as DrawState | null;
      const prevData = game.prevData as DrawState | null;

      const gradient = ctx.createRadialGradient(
        CANVAS_W / 2, CANVAS_H / 2, 0,
        CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.75,
      );
      gradient.addColorStop(0, "#081026");
      gradient.addColorStop(1, PALETTE.bg);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.strokeStyle = PALETTE.borderLight;
      ctx.lineWidth = 3;
      ctx.shadowColor = PALETTE.headGlow;
      ctx.shadowBlur = 14;
      ctx.strokeRect(1, 1, CANVAS_W - 2, CANVAS_H - 2);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      ctx.strokeStyle = PALETTE.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(4, 4, CANVAS_W - 8, CANVAS_H - 8);

      ctx.strokeStyle = PALETTE.grid;
      ctx.lineWidth = 1;
      ctx.shadowColor = PALETTE.gridGlow;
      ctx.shadowBlur = 10;
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
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      if (data) {
        const eased = smoothstep(interp);
        data.snake.forEach((seg, i) => {
          const prev = prevData?.snake[i];
          const px = prev ? lerp(prev.x, seg.x, eased) * CELL : seg.x * CELL;
          const py = prev ? lerp(prev.y, seg.y, eased) * CELL : seg.y * CELL;
          if (i === 0) {
            drawSnakeHead(ctx, px, py, data.direction);
          } else {
            drawSnakeBody(ctx, px, py, i);
          }
        });

        drawPixelApple(ctx, data.food.x * CELL, data.food.y * CELL);
      }

      const score = state.score;
      if (score !== lastScoreRef.current) {
        lastScoreRef.current = score;
        if (scoreSpanRef.current) scoreSpanRef.current.textContent = String(score);
      }

      const level = data?.level ?? 1;
      if (level !== lastLevelRef.current) {
        lastLevelRef.current = level;
        if (levelSpanRef.current) levelSpanRef.current.textContent = String(level);
      }
    },
    [game, viewport.dpr, scale],
  );

  const handleStatusChange = useCallback(
    (status: GameStatusValue) => {
      statusRef.current = status;
      setStatusVersion((v) => v + 1);
    },
    [],
  );

  useGameLoop(game, game.getTickMs(), drawFrame, handleStatusChange);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = viewport.dpr;
    canvas.width = Math.max(1, Math.round(CANVAS_W * dpr));
    canvas.height = Math.max(1, Math.round(CANVAS_H * dpr));
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
  }, [viewport.dpr]);

  const handleKey = useCallback((e: KeyboardEvent) => {
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

    if (status === GameStatus.LOST || status === GameStatus.ABANDONED) {
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
  }, [game]);

  useGameKeyboard(focused, handleKey);

  const status = statusRef.current;
  const state = game.getState();

  useEffect(() => {
    if (status !== GameStatus.ABANDONED) return;
    const t = setTimeout(() => {
      send(game, GameCommand.TO_TITLE);
    }, ABANDONED_DELAY_MS);
    return () => clearTimeout(t);
  }, [game, status]);

  const pixelFont = { fontFamily: "var(--font-game)" };

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full relative overflow-hidden"
      style={{ backgroundColor: isMaximized ? "#000" : "#020617" }}
      {...(hasCoarsePointer ? swipeHandlers : {})}
    >
      <div
        className="p-2 rounded-xl border-2 absolute top-0 left-0"
          style={{
            backgroundColor: PALETTE.platform,
            borderColor: PALETTE.platformBorder,
            boxShadow: `0 0 18px ${PALETTE.gridGlow}, inset 0 0 14px rgba(56, 189, 248, 0.04)`,
            width: game.naturalWidth,
            height: game.naturalHeight,
            transform: `translate(${offsets.x}px, ${offsets.y}px) scale(${scale})`,
            transformOrigin: "top left",
            visibility: viewport.ready ? "visible" : "hidden",
          }}
        >
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
            {$.score}: <span ref={scoreSpanRef}>{state.score}</span>
          </span>
          <span
            className="text-[10px] tracking-wider"
            style={{ ...pixelFont, color: PALETTE.head }}
          >
            {$.level}: <span ref={levelSpanRef}>{(state.data as DrawState | null)?.level ?? 1}</span>
          </span>
        </div>
      </div>

      {hasCoarsePointer && (status === GameStatus.PLAYING || status === GameStatus.PAUSED) && (
        <GameMobileActionBar
          placement="bottom-center"
          bottomOffset={176}
          actions={
            <>
              <GameButton
                size="sm"
                variant="secondary"
                onClick={() => send(game, status === GameStatus.PLAYING ? GameCommand.PAUSE : GameCommand.RESUME)}
              >
                {status === GameStatus.PLAYING ? $.pause : $.play}
              </GameButton>
              <GameButton size="sm" variant="danger" onClick={() => send(game, GameCommand.GIVE_UP)}>
                {$.exit}
              </GameButton>
            </>
          }
        />
      )}

      {status === GameStatus.WAITING && (
        <GameTitleScreen
          icon={"\u{1F40D}"}
          title={$.title}
          subtitle={$.subtitle}
          primaryAction={<GameButton onClick={() => send(game, GameCommand.START)}>{$.start}</GameButton>}
          footer={hasCoarsePointer ? $.tap_to_start : $.or_press_enter}
        />
      )}

      {status === GameStatus.PAUSED && (
        <GamePauseScreen
          title={$.paused}
          actions={
            <>
              <GameButton onClick={() => send(game, GameCommand.RESUME)}>{$.resume}</GameButton>
              <GameButton variant="secondary" onClick={() => send(game, GameCommand.RESTART)}>{$.restart}</GameButton>
              <GameButton variant="danger" onClick={() => send(game, GameCommand.GIVE_UP)}>{$.quit}</GameButton>
            </>
          }
          footer={hasCoarsePointer ? $.tap_resume : $.esc_to_resume}
        />
      )}

      {status === GameStatus.ABANDONED && (
        <GameResultScreen
          title={$.abandoned}
          tone="danger"
          subtitle={`${$.score}: ${state.score}`}
          footer={$.returning_to_title}
        />
      )}

      {status === GameStatus.LOST && (
        <GameResultScreen
          title={$.game_over}
          tone="danger"
          subtitle={`${$.score}: ${state.score}`}
          actions={
            <>
              <GameButton onClick={() => send(game, GameCommand.PLAY_AGAIN)}>{$.play_again}</GameButton>
              <GameButton variant="secondary" onClick={() => send(game, GameCommand.TO_TITLE)}>{$.title_screen}</GameButton>
            </>
          }
          footer={hasCoarsePointer ? $.tap_to_continue : $.enter_to_retry}
        />
      )}

      {hasCoarsePointer && status === GameStatus.PLAYING && (
        <TouchDPad
          onDirection={sendDirection}
          ariaLabels={{ up: $.move_up, down: $.move_down, left: $.move_left, right: $.move_right }}
        />
      )}
    </div>
  );
}
