import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const ABANDONED_DELAY_MS = 1500;

import {
  TwentyFortyEightGame,
  type BoardData,
  type BoardSize,
  type Direction,
  type TilePosition,
  type Tile,
} from "../../games/twenty-forty-eight/twenty-forty-eight-game";
import { GameStatus } from "../../games/core/constants/game-status";
import type { GameStatusValue } from "../../games/core/constants/game-status";
import { ActionType, GameCommand } from "../../games/core/constants/action-types";
import { useGameViewport } from "./useGameViewport";
import { GameButton, GameHud, GameHudStat, GameMobileActionBar, GameSegmentedControl, GameTitleScreen, GamePauseScreen, GameResultScreen, TouchDPad } from "./GameUI";
import { computeGameOffsets, computeGameScale } from "./gameViewportSizing";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useSwipeDirection } from "./useSwipeDirection";

interface Props {
  game: TwentyFortyEightGame;
  isMaximized?: boolean;
}

interface TileItem {
  id: number;
  value: number;
  row: number;
  col: number;
}

function cellsEqual(a: (Tile | null)[][], b: (Tile | null)[][]): boolean {
  if (a.length !== b.length) return false;
  for (let row = 0; row < a.length; row++) {
    if (a[row].length !== b[row].length) return false;
    for (let col = 0; col < a[row].length; col++) {
      const ta = a[row][col];
      const tb = b[row][col];
      if ((ta === null) !== (tb === null)) return false;
      if (ta && tb && (ta.id !== tb.id || ta.value !== tb.value)) return false;
    }
  }
  return true;
}

function buildPositionMap(cells: (Tile | null)[][]): Record<number, TilePosition> {
  const map: Record<number, TilePosition> = {};
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      const tile = cells[row][col];
      if (tile) map[tile.id] = { row, col };
    }
  }
  return map;
}

const PALETTE: Record<number, { bg: string; glow: string; text: string }> = {
  2:    { bg: "#0b1220", glow: "rgba(6,182,212,0.25)", text: "#a5f3fc" },
  4:    { bg: "#0c1f2d", glow: "rgba(34,211,238,0.35)", text: "#67e8f9" },
  8:    { bg: "#0f2b3a", glow: "rgba(56,189,248,0.4)",  text: "#38bdf8" },
  16:   { bg: "#142744", glow: "rgba(59,130,246,0.45)", text: "#60a5fa" },
  32:   { bg: "#1a2754", glow: "rgba(99,102,241,0.5)",  text: "#818cf8" },
  64:   { bg: "#211b4d", glow: "rgba(139,92,246,0.55)", text: "#a78bfa" },
  128:  { bg: "#2d1a4d", glow: "rgba(168,85,247,0.6)", text: "#c084fc" },
  256:  { bg: "#3a174c", glow: "rgba(192,38,211,0.65)", text: "#e879f9" },
  512:  { bg: "#4a154a", glow: "rgba(217,70,239,0.7)",  text: "#f0abfc" },
  1024: { bg: "#581143", glow: "rgba(236,72,153,0.75)", text: "#f9a8d4" },
  2048: { bg: "#6d0f31", glow: "rgba(244,63,94,0.85)",  text: "#fda4af" },
};

function tilePalette(value: number) {
  return PALETTE[value] ?? { bg: "#2a0a2a", glow: "rgba(250,204,21,0.9)", text: "#fef08a" };
}

const BOARD_BG = "#05070f";
const BOARD_BORDER = "#1e3a8a";
const BOARD_BORDER_GLOW = "rgba(56, 189, 248, 0.25)";
const EMPTY_CELL = "rgba(15, 23, 42, 0.75)";
const GRID_AREA_SIZE = 320;
const GRID_GAP = 8;
const GRID_PADDING = 8;
const TILE_TRANSITION_MS = 130;

const SIZES: { value: BoardSize; label: string }[] = [
  { value: 3, label: "3×3" },
  { value: 4, label: "4×4" },
  { value: 5, label: "5×5" },
  { value: 6, label: "6×6" },
];

function send(game: TwentyFortyEightGame, command: string) {
  game.handleAction({ type: ActionType.COMMAND, data: command }, "player");
}

function move(game: TwentyFortyEightGame, direction: Direction) {
  game.handleAction({ type: ActionType.MOVE, data: direction }, "player");
}

function AnimatedTile({
  tile,
  prev,
  size,
  isNew,
  fontSize,
}: {
  tile: TileItem;
  prev: TilePosition | null;
  size: number;
  isNew: boolean;
  fontSize: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const cellSize = (GRID_AREA_SIZE - 2 * GRID_PADDING - (size - 1) * GRID_GAP) / size;
  const palette = tilePalette(tile.value);
  const endX = tile.col * (cellSize + GRID_GAP);
  const endY = tile.row * (cellSize + GRID_GAP);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const hasMove = prev && (prev.row !== tile.row || prev.col !== tile.col);

    if (!initializedRef.current) {
      initializedRef.current = true;
      if (isNew) {
        el.style.transition = "none";
        el.style.transform = `translate(${endX}px, ${endY}px) scale(0.5)`;
        el.style.opacity = "0";
        void el.getBoundingClientRect();
        el.style.transition = `transform ${TILE_TRANSITION_MS}ms ease-out, opacity ${TILE_TRANSITION_MS}ms ease-out`;
        el.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
        el.style.opacity = "1";
      } else {
        el.style.transition = "none";
        el.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
        el.style.opacity = "1";
      }
      return;
    }

    if (hasMove) {
      const startX = prev.col * (cellSize + GRID_GAP);
      const startY = prev.row * (cellSize + GRID_GAP);
      el.style.transition = "none";
      el.style.transform = `translate(${startX}px, ${startY}px) scale(1)`;
      el.style.opacity = "1";
      void el.getBoundingClientRect();
      el.style.transition = `transform ${TILE_TRANSITION_MS}ms ease-out, opacity ${TILE_TRANSITION_MS}ms ease-out`;
      el.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
    }
  }, [prev, tile, cellSize, isNew, endX, endY]);

  return (
    <div
      ref={ref}
      className="absolute top-0 left-0 rounded-lg font-bold flex items-center justify-center overflow-hidden"
      style={{
        width: cellSize,
        height: cellSize,
        backgroundColor: palette.bg,
        color: palette.text,
        fontSize,
        boxShadow: `0 0 18px ${palette.glow}, inset 0 0 8px rgba(255,255,255,0.06)`,
        textShadow: `0 0 10px ${palette.glow}`,
        border: `1px solid ${palette.glow}`,
        boxSizing: "border-box",
        lineHeight: 1,
      }}
    >
      {tile.value}
    </div>
  );
}

export function TwentyFortyEightView({ game, isMaximized }: Props) {
  const [statusVersion, setStatusVersion] = useState(0);
  void statusVersion;
  const statusRef = useRef<GameStatusValue>(game.getStatus());
  const containerRef = useRef<HTMLDivElement>(null);
  const [pendingSize, setPendingSize] = useState<BoardSize>(game.size);

  const { isMobile, hasCoarsePointer } = useBreakpoint();
  const viewport = useGameViewport(containerRef, isMaximized);
  const scale = computeGameScale({
    naturalWidth: game.naturalWidth,
    naturalHeight: game.naturalHeight,
    containerWidth: viewport.width,
    containerHeight: viewport.height,
    isMobile,
  });
  const offsets = computeGameOffsets(game.naturalWidth, game.naturalHeight, scale, viewport.width, viewport.height);
  const animRef = useRef<BoardData | null>(null);

  const refresh = useCallback(() => {
    const next = game.getStatus();
    statusRef.current = next;
    if (next === GameStatus.WAITING) {
      animRef.current = null;
    }
    setStatusVersion((v) => v + 1);
  }, [game]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startNewGame = useCallback((selectedSize: BoardSize) => {
    game.restart({ slots: game.slots, rules: { size: selectedSize } });
    refresh();
  }, [game, refresh]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const status = game.getStatus();
      const dirMap: Record<string, Direction> = {
        ArrowUp: "UP",
        ArrowDown: "DOWN",
        ArrowLeft: "LEFT",
        ArrowRight: "RIGHT",
        w: "UP",
        W: "UP",
        s: "DOWN",
        S: "DOWN",
        a: "LEFT",
        A: "LEFT",
        d: "RIGHT",
        D: "RIGHT",
      };

      if (status === GameStatus.WAITING) {
        if (e.key === "Enter") {
          e.preventDefault();
          startNewGame(pendingSize);
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
        refresh();
        return;
      }

      if (status === GameStatus.WON || status === GameStatus.LOST || status === GameStatus.ABANDONED) {
        if (e.key === "Enter") {
          e.preventDefault();
          send(game, GameCommand.PLAY_AGAIN);
          refresh();
        }
        return;
      }

      if (status === GameStatus.PAUSED) return;

      const dir = dirMap[e.key];
      if (dir) {
        e.preventDefault();
        move(game, dir);
        refresh();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [game, refresh, pendingSize, startNewGame]);

  // Auto-reset to title screen after the player abandons the game.
  useEffect(() => {
    if (statusRef.current !== GameStatus.ABANDONED) return;
    const t = setTimeout(() => {
      send(game, GameCommand.TO_TITLE);
      refresh();
    }, ABANDONED_DELAY_MS);
    return () => clearTimeout(t);
  }, [game, refresh, statusVersion]);

  const data = game.getState().data as BoardData | null;
  const cells = data?.cells ?? [];
  const size = data?.size ?? 4;
  const score = game.getScore();
  const moves = game.getMoves();

  const shouldAnimate = !animRef.current || !data || !cellsEqual(animRef.current.cells, data.cells);
  const prevPositions = shouldAnimate && data ? buildPositionMap(animRef.current?.cells ?? []) : {};

  useEffect(() => {
    if (shouldAnimate && data) {
      animRef.current = data;
    }
  }, [shouldAnimate, data]);

  const estimatedCellSize = (GRID_AREA_SIZE - 2 * GRID_PADDING - (size - 1) * GRID_GAP) / size;
  const fontSize = estimatedCellSize <= 42 ? 14 : estimatedCellSize <= 50 ? 16 : estimatedCellSize <= 58 ? 20 : estimatedCellSize <= 72 ? 26 : 32;

  const tiles: TileItem[] = [];
  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < cells[row].length; col++) {
      const tile = cells[row][col];
      if (tile) tiles.push({ id: tile.id, value: tile.value, row, col });
    }
  }
  const swipeHandlers = useSwipeDirection((direction) => {
    if (statusRef.current !== GameStatus.PLAYING) return;
    move(game, direction);
    refresh();
  });

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full relative select-none overflow-hidden"
      style={{ backgroundColor: isMaximized ? "#000" : "#02040a" }}
      tabIndex={-1}
      {...(hasCoarsePointer ? swipeHandlers : {})}
    >
      <div
        className="p-3 rounded-2xl border-2 absolute top-0 left-0 inline-flex flex-col items-center"
        style={{
          backgroundColor: BOARD_BG,
          borderColor: BOARD_BORDER,
          boxShadow: `0 0 24px ${BOARD_BORDER_GLOW}, inset 0 0 18px rgba(56, 189, 248, 0.05)`,
          boxSizing: "border-box",
          width: game.naturalWidth,
          height: game.naturalHeight,
          transform: `translate(${offsets.x}px, ${offsets.y}px) scale(${scale})`,
          transformOrigin: "top left",
          visibility: viewport.ready ? "visible" : "hidden",
        }}
      >
        <GameHud width={GRID_AREA_SIZE}>
          <span
            className="text-sm tracking-widest font-bold"
            style={{ fontFamily: "var(--font-game)", color: "#22d3ee", lineHeight: 1 }}
          >
            2048
          </span>
          <div className="flex gap-3">
            <GameHudStat label="SCORE" value={score} minWidth={76} />
            <GameHudStat label="MOVES" value={moves} tone="secondary" minWidth={66} />
          </div>
        </GameHud>

        <div
          className="grid rounded-xl p-2 relative"
          style={{
            gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
            gap: `${GRID_GAP}px`,
            width: GRID_AREA_SIZE,
            height: GRID_AREA_SIZE,
            minWidth: GRID_AREA_SIZE,
            minHeight: GRID_AREA_SIZE,
            backgroundColor: "rgba(30, 58, 138, 0.25)",
            boxShadow: "inset 0 0 20px rgba(56,189,248,0.1)",
            boxSizing: "border-box",
            flex: "0 0 auto",
          }}
        >
          {Array.from({ length: size * size }).map((_, idx) => (
            <div
              key={`bg-${idx}`}
              className="rounded-lg"
              style={{
                width: "100%",
                height: "100%",
                minWidth: 0,
                minHeight: 0,
                backgroundColor: EMPTY_CELL,
                border: "1px solid rgba(56,189,248,0.08)",
                boxSizing: "border-box",
              }}
            />
          ))}

          <div
            className="absolute overflow-hidden"
            style={{ top: GRID_PADDING, left: GRID_PADDING, width: GRID_AREA_SIZE - 2 * GRID_PADDING, height: GRID_AREA_SIZE - 2 * GRID_PADDING }}
          >
            {statusRef.current !== GameStatus.WAITING && tiles.map((tile) => {
              const prev = prevPositions[tile.id];
              const isNew = !prev;
              return (
                <AnimatedTile
                  key={tile.id}
                  tile={tile}
                  prev={prev}
                  size={size}
                  isNew={isNew}
                  fontSize={fontSize}
                />
              );
            })}
          </div>
        </div>

        {hasCoarsePointer && (statusRef.current === GameStatus.PLAYING || statusRef.current === GameStatus.PAUSED) && (
          <GameMobileActionBar
            placement="inline-bottom"
            actions={
              <>
                <GameButton
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    send(game, statusRef.current === GameStatus.PLAYING ? GameCommand.PAUSE : GameCommand.RESUME);
                    refresh();
                  }}
                >
                  {statusRef.current === GameStatus.PLAYING ? "PAUSE" : "PLAY"}
                </GameButton>
                <GameButton
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    send(game, GameCommand.GIVE_UP);
                    refresh();
                  }}
                >
                  EXIT
                </GameButton>
              </>
            }
          />
        )}

        {hasCoarsePointer && statusRef.current === GameStatus.PLAYING && (
          <TouchDPad
            placement="inline-bottom"
            onDirection={(direction) => {
              move(game, direction);
              refresh();
            }}
          />
        )}
      </div>

      {statusRef.current === GameStatus.WAITING && (
        <GameTitleScreen
          icon={"🧮"}
          title="2048"
          subtitle="Merge. Glow. Win."
          controls={
            <>
              <p className="text-[10px] font-game" style={{ color: "#94a3b8" }}>BOARD SIZE</p>
              <GameSegmentedControl
                options={SIZES.map((s) => ({ value: String(s.value), label: s.label }))}
                value={String(pendingSize)}
                onChange={(value) => setPendingSize(Number(value) as BoardSize)}
              />
            </>
          }
          primaryAction={<GameButton onClick={() => startNewGame(pendingSize)}>START</GameButton>}
          footer={hasCoarsePointer ? "Tap to start" : "ENTER to start"}
        />
      )}

      {statusRef.current === GameStatus.PAUSED && (
        <GamePauseScreen
          actions={
            <>
            <GameButton
              onClick={() => {
                send(game, GameCommand.RESUME);
                refresh();
              }}
            >
              RESUME
            </GameButton>
            <GameButton
              variant="secondary"
              onClick={() => {
                send(game, GameCommand.RESTART);
                refresh();
              }}
            >
              RESTART
            </GameButton>
            <GameButton
              variant="danger"
              onClick={() => {
                send(game, GameCommand.GIVE_UP);
                refresh();
              }}
            >
              QUIT
            </GameButton>
            </>
          }
          footer={hasCoarsePointer ? "Tap resume to continue" : "ESC to resume"}
        />
      )}

      {statusRef.current === GameStatus.ABANDONED && (
        <GameResultScreen
          title="ABANDONED"
          tone="danger"
          subtitle={`SCORE: ${score}`}
          footer="Returning to title screen..."
        />
      )}

      {(statusRef.current === GameStatus.WON || statusRef.current === GameStatus.LOST) && (
        <GameResultScreen
          title={statusRef.current === GameStatus.WON ? "YOU WIN" : "GAME OVER"}
          tone={statusRef.current === GameStatus.WON ? "primary" : "danger"}
          subtitle={`SCORE: ${score}`}
          actions={
            <>
            <GameButton
              onClick={() => {
                send(game, GameCommand.PLAY_AGAIN);
                refresh();
              }}
            >
              PLAY AGAIN
            </GameButton>
            <GameButton
              variant="secondary"
              onClick={() => {
                send(game, GameCommand.TO_TITLE);
                refresh();
              }}
            >
              TITLE SCREEN
            </GameButton>
            </>
          }
          footer={hasCoarsePointer ? "Tap to retry" : "ENTER to retry"}
        />
      )}

      <style>{`
        @keyframes neon-pop {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
