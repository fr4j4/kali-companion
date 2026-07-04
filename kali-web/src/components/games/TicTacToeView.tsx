import { useCallback, useEffect, useRef, useState } from "react";
import { useTicTacToeI18n } from "../../games/tic-tac-toe/tic-tac-toe-i18n";

const ABANDONED_DELAY_MS = 1500;

import { TicTacToeGame, type TicTacToeData, type Difficulty } from "../../games/tic-tac-toe/tic-tac-toe-game";
import { TicTacToeCPUPlayer } from "../../games/tic-tac-toe/tic-tac-toe-cpu";
import type { GameSessionManager } from "../../games/core/game-session-manager";
import { GameStatus } from "../../games/core/constants/game-status";
import { ActionType, GameCommand } from "../../games/core/constants/action-types";
import { SlotId } from "../../games/core/constants/player-types";
import { KaliStatus, GameMode, type KaliStatusValue, type GameModeValue } from "../../games/core/constants/game-ai";
import { useGameViewport } from "./useGameViewport";
import { GameButton, GameHud, GameHudStat, GameMobileActionBar, GamePauseScreen, GameResultScreen, GameSegmentedControl, GameTitleScreen } from "./GameUI";
import { computeGameOffsets, computeGameScale } from "./gameViewportSizing";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import { useGameKeyboard } from "../../hooks/useGameKeyboard";

interface Props {
  game: TicTacToeGame;
  manager: GameSessionManager;
  hasKali?: boolean;
  isMaximized?: boolean;
  focused?: boolean;
}

const PALETTE = {
  bg: "#05070f",
  border: "#1e3a8a",
  borderGlow: "rgba(56, 189, 248, 0.25)",
  empty: "rgba(15, 23, 42, 0.75)",
  x: "#22d3ee",
  xGlow: "rgba(34, 211, 238, 0.55)",
  o: "#d946ef",
  oGlow: "rgba(217, 70, 239, 0.55)",
  win: "rgba(34, 211, 238, 0.25)",
  text: "#e0f2fe",
};

type Starter = typeof SlotId.PLAYER | typeof SlotId.OPPONENT;

export function TicTacToeView({ game, manager, hasKali, isMaximized, focused = true }: Props) {
  const $ = useTicTacToeI18n();
  const [tick, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewport = useGameViewport(containerRef, isMaximized);
  const { isMobile, hasCoarsePointer } = useBreakpoint();
  const scale = computeGameScale({
    naturalWidth: game.naturalWidth,
    naturalHeight: game.naturalHeight,
    containerWidth: viewport.width,
    containerHeight: viewport.height,
    isMobile,
  });
  const offsets = computeGameOffsets(game.naturalWidth, game.naturalHeight, scale, viewport.width, viewport.height);

  useEffect(() => {
    const unsub = manager.subscribe(() => setTick((v) => v + 1));
    return unsub;
  }, [manager]);

  const [mode, setMode] = useState<GameModeValue>(GameMode.CPU);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [starter, setStarter] = useState<Starter>(SlotId.PLAYER);

  const kaliStatus: KaliStatusValue = manager.kaliStatus;
  const kaliError = manager.kaliError;
  const retryCount = manager.retryCount;

  const startGame = useCallback(() => {
    if (mode === GameMode.CPU) {
      manager.fallbackToCPU(new TicTacToeCPUPlayer(difficulty));
    }
    manager.restart({
      slots: game.slots,
      rules: { starter, difficulty, mode },
    });
  }, [game, manager, starter, difficulty, mode]);

  const handleCellClick = (row: number, col: number) => {
    if (game.getStatus() !== GameStatus.PLAYING) return;
    if (kaliStatus === KaliStatus.THINKING) return;
    const data = game.getState().data as TicTacToeData | null;
    if (data?.currentSlot !== SlotId.PLAYER) return;

    manager.submitPlayerAction({ type: ActionType.MOVE, data: { row, col } });
  };

  const sendCommand = useCallback(
    (command: string) => {
      manager.sendCommand(command as (typeof GameCommand)[keyof typeof GameCommand]);
    },
    [manager],
  );

  const handleKaliRetry = useCallback(() => {
    manager.retryAI();
  }, [manager]);

  const handleFallbackToCPU = useCallback(() => {
    manager.fallbackToCPU(new TicTacToeCPUPlayer(difficulty));
    manager.restart({
      slots: game.slots,
      rules: { starter, difficulty, mode: GameMode.CPU },
    });
  }, [manager, game, difficulty, starter]);

  const handleGiveUp = useCallback(() => {
    manager.giveUp();
  }, [manager]);

  useEffect(() => {
    if (game.getStatus() !== GameStatus.ABANDONED) return;
    const t = setTimeout(() => {
      sendCommand(GameCommand.TO_TITLE);
    }, ABANDONED_DELAY_MS);
    return () => clearTimeout(t);
  }, [game, tick, sendCommand]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    const status = game.getStatus();

    if (status === GameStatus.WAITING) {
      if (e.key === "Enter") {
        e.preventDefault();
        startGame();
      }
      return;
    }

    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (status === GameStatus.PLAYING) {
        sendCommand(GameCommand.PAUSE);
      } else if (status === GameStatus.PAUSED) {
        sendCommand(GameCommand.RESUME);
      }
      return;
    }

    if (status === GameStatus.WON || status === GameStatus.LOST || status === GameStatus.DRAW || status === GameStatus.ABANDONED) {
      if (e.key === "Enter") {
        e.preventDefault();
        sendCommand(GameCommand.PLAY_AGAIN);
      }
      return;
    }
  }, [game, startGame, sendCommand]);

  useGameKeyboard(focused, handleKey);

  void tick;

  const state = game.getState();
  const data = state.data as TicTacToeData | null;
  const board = data?.board ?? Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null));
  const currentSlot = data?.currentSlot ?? SlotId.PLAYER;
  const winningLine = data?.winningLine;
  const status = game.getStatus();

  const isWinningCell = (row: number, col: number) => {
    return winningLine?.some(([r, c]) => r === row && c === col) ?? false;
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full relative overflow-hidden"
      style={{ backgroundColor: isMaximized ? "#000" : "transparent" }}
    >
      <div
        className="relative rounded-2xl border-2 absolute top-0 left-0 flex flex-col items-center"
        style={{
          backgroundColor: PALETTE.bg,
          borderColor: PALETTE.border,
          boxShadow: `0 0 24px ${PALETTE.borderGlow}, inset 0 0 18px rgba(56, 189, 248, 0.05)`,
          width: game.naturalWidth,
          height: game.naturalHeight,
          transform: `translate(${offsets.x}px, ${offsets.y}px) scale(${scale})`,
          transformOrigin: "top left",
          boxSizing: "border-box",
          visibility: viewport.ready ? "visible" : "hidden",
          paddingTop: 14,
          paddingBottom: 14,
        }}
      >
        <GameHud width={288}>
          <span
            className="text-sm tracking-widest font-bold"
            style={{ fontFamily: "var(--font-game)", color: PALETTE.x, lineHeight: 1 }}
          >
            {$.title}
          </span>
          <GameHudStat
            label={$.state}
            value={
              currentSlot === SlotId.PLAYER
                ? $.your_turn
                : $.thinking
            }
            tone={currentSlot === SlotId.PLAYER ? "primary" : "secondary"}
            minWidth={92}
          />
        </GameHud>

      <div
        className="grid rounded-xl p-2"
        style={{
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gridTemplateRows: "repeat(3, minmax(0, 1fr))",
          gap: "8px",
          width: 288,
          height: 288,
          backgroundColor: "rgba(30, 58, 138, 0.25)",
          boxShadow: "inset 0 0 20px rgba(56,189,248,0.1)",
          boxSizing: "border-box",
        }}
      >
        {board.flatMap((row, r) =>
          row.map((cell, c) => {
            const highlight = isWinningCell(r, c);
            const clickable = status === GameStatus.PLAYING && currentSlot === SlotId.PLAYER && cell === null;
            return (
              <button
                key={`${r}-${c}`}
                onClick={() => handleCellClick(r, c)}
                disabled={!clickable}
                className={`relative flex items-center justify-center rounded-lg font-bold transition-all duration-150 ${
                  clickable ? "hover:brightness-110 cursor-pointer" : "cursor-default"
                }`}
                style={{
                  width: "100%",
                  height: "100%",
                  minWidth: 0,
                  minHeight: 0,
                  backgroundColor: highlight ? PALETTE.win : PALETTE.empty,
                  border: "1px solid rgba(56,189,248,0.15)",
                  boxSizing: "border-box",
                  fontSize: 48,
                  color: cell === "X" ? PALETTE.x : PALETTE.o,
                  textShadow: cell === "X" ? `0 0 14px ${PALETTE.xGlow}` : `0 0 14px ${PALETTE.oGlow}`,
                  boxShadow: highlight ? `inset 0 0 18px ${PALETTE.xGlow}` : "none",
                  lineHeight: 1,
                }}
              >
                {cell || ""}
              </button>
            );
          }),
        )}
      </div>

      {hasCoarsePointer && (status === GameStatus.PLAYING || status === GameStatus.PAUSED) && (
        <GameMobileActionBar
          placement="inline-bottom"
          actions={
            <>
              <GameButton
                size="sm"
                variant="secondary"
                onClick={() => sendCommand(status === GameStatus.PLAYING ? GameCommand.PAUSE : GameCommand.RESUME)}
              >
                {status === GameStatus.PLAYING ? $.pause : $.play}
              </GameButton>
              <GameButton size="sm" variant="danger" onClick={() => sendCommand(GameCommand.GIVE_UP)}>
                {$.exit}
              </GameButton>
            </>
          }
        />
      )}

      {status === GameStatus.WAITING && (
        <GameTitleScreen
          icon={"\u{271A}"}
          title={$.title}
          subtitle={$.subtitle}
          controls={
            <>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] font-game" style={{ color: "#94a3b8" }}>{$.mode}</span>
                <GameSegmentedControl
                  options={[
                    { value: GameMode.CPU, label: $.vs_cpu },
                    { value: GameMode.KALI, label: $.vs_kali },
                  ]}
                  value={mode}
                  onChange={(value) => setMode(value)}
                  disabledValue={(value) => value === GameMode.KALI && !hasKali}
                />
                {!hasKali && (
                  <span className="text-[8px] font-game" style={{ color: "#64748b" }}>
                    {$.connect_ai_hint}
                  </span>
                )}
              </div>
              {mode === GameMode.CPU && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-game" style={{ color: "#94a3b8" }}>{$.difficulty}</span>
                  <GameSegmentedControl
                    options={[
                      { value: "easy", label: $.easy },
                      { value: "medium", label: $.medium },
                      { value: "hard", label: $.hard },
                    ]}
                    value={difficulty}
                    onChange={(value) => setDifficulty(value)}
                  />
                </div>
              )}
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] font-game" style={{ color: "#94a3b8" }}>{$.starter}</span>
                <GameSegmentedControl
                  options={[
                    { value: SlotId.PLAYER, label: $.you_label },
                    { value: SlotId.OPPONENT, label: $.opponent },
                  ]}
                  value={starter}
                  onChange={(value) => setStarter(value)}
                />
              </div>
            </>
          }
          primaryAction={<GameButton onClick={startGame}>{$.start}</GameButton>}
          footer={hasCoarsePointer ? $.tap_to_start : $.enter_to_start}
        />
      )}

      {status === GameStatus.PAUSED && (
        <GamePauseScreen
          title={$.paused}
          actions={
            <>
              <GameButton onClick={() => sendCommand(GameCommand.RESUME)}>{$.resume}</GameButton>
              <GameButton variant="secondary" onClick={() => sendCommand(GameCommand.RESTART)}>{$.restart}</GameButton>
              <GameButton variant="danger" onClick={() => sendCommand(GameCommand.GIVE_UP)}>{$.quit}</GameButton>
            </>
          }
          footer={hasCoarsePointer ? $.tap_resume : $.esc_to_resume}
        />
      )}

      {kaliStatus === KaliStatus.ERROR && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#02040a]/92 rounded-xl z-30 backdrop-blur-[2px]">
          <span className="text-4xl mb-3" style={{ filter: "drop-shadow(0 0 14px rgba(244,63,94,0.8))" }}>
            {"\u26A0"}
          </span>
          <h2 className="text-sm mb-2 text-center px-4" style={{ fontFamily: "'Press Start 2P', monospace", color: "#f43f5e" }}>
            {$.error}
          </h2>
          <p className="text-[9px] mb-1 text-center px-6" style={{ fontFamily: "'Press Start 2P', monospace", color: "#fca5a5" }}>
            {kaliError?.message ?? $.unknown_error}
          </p>
          {kaliError?.code && (
            <p className="text-[8px] mb-4 text-center" style={{ fontFamily: "'Press Start 2P', monospace", color: "#737373" }}>
              [{kaliError.code}]
            </p>
          )}
          <div className="flex flex-col gap-3 mt-2">
            <button
              onClick={handleKaliRetry}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", backgroundColor: PALETTE.x, color: "#020617", boxShadow: `0 0 14px ${PALETTE.xGlow}` }}
            >
              {$.retry}
            </button>
            {retryCount >= 1 && (
              <p className="text-[8px] text-center" style={{ fontFamily: "'Press Start 2P', monospace", color: "#f59e0b" }}>
                {$.last_attempt}
              </p>
            )}
            <button
              onClick={handleFallbackToCPU}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", backgroundColor: "#1e3a8a", color: "#e0f2fe", border: "1px solid #38bdf8" }}
            >
              {$.continue_cpu}
            </button>
            <button
              onClick={handleGiveUp}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", color: "#e0f2fe", backgroundColor: "#7f1d1d", border: "1px solid #f87171" }}
            >
              {$.give_up}
            </button>
          </div>
        </div>
      )}

      {status === GameStatus.ABANDONED && (
        <GameResultScreen
          title={$.abandoned}
          tone="danger"
          footer={$.returning_to_title}
        />
      )}

      {(status === GameStatus.WON || status === GameStatus.LOST || status === GameStatus.DRAW) && (
        <GameResultScreen
          title={status === GameStatus.WON ? $.won : status === GameStatus.LOST ? $.lost : $.draw}
          tone={status === GameStatus.WON ? "primary" : status === GameStatus.LOST ? "danger" : "secondary"}
          actions={
            <>
              <GameButton onClick={() => sendCommand(GameCommand.PLAY_AGAIN)}>{$.play_again}</GameButton>
              <GameButton variant="secondary" onClick={() => sendCommand(GameCommand.TO_TITLE)}>{$.title_screen}</GameButton>
            </>
          }
          footer={hasCoarsePointer ? $.tap_to_continue : $.enter_to_continue}
        />
      )}
      </div>
    </div>
  );
}
