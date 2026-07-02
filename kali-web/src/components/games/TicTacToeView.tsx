import { useCallback, useEffect, useRef, useState } from "react";
import { TicTacToeGame, type TicTacToeData, type Difficulty } from "../../games/tic-tac-toe/tic-tac-toe-game";
import { TicTacToeCPUPlayer } from "../../games/tic-tac-toe/tic-tac-toe-cpu";
import { aiSlotFiller } from "../../games/ai/ai-slot-filler";
import { AISlot } from "../../games/ai/ai-slot";
import { KaliError } from "../../games/ai/kali-error";
import { hasLLMIntegration } from "../../games/ai/game-llm-provider";
import { useChat } from "../../hooks/useChat";
import { GameStatus } from "../../games/core/constants/game-status";
import type { GameStatusValue } from "../../games/core/constants/game-status";
import { ActionType, GameCommand } from "../../games/core/constants/action-types";
import { SlotId } from "../../games/core/constants/player-types";
import { GameType } from "../../games/core/constants/game-types";
import { KaliStatus, GameMode, KALI_MAX_RETRIES, type KaliStatusValue, type GameModeValue } from "../../games/core/constants/game-ai";


interface Props {
  game: TicTacToeGame;
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

function send(game: TicTacToeGame, command: string) {
  game.handleAction({ type: ActionType.COMMAND, data: command }, SlotId.PLAYER);
}

export function TicTacToeView({ game }: Props) {
  const chat = useChat();
  const systemStatus = chat.systemStatus;
  const hasKali = hasLLMIntegration(systemStatus);

  const [statusVersion, setStatusVersion] = useState(0);
  void statusVersion;
  const statusRef = useRef<GameStatusValue>(game.getStatus());

  const [mode, setMode] = useState<GameModeValue>(GameMode.CPU);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [starter, setStarter] = useState<Starter>(SlotId.PLAYER);

  const [kaliStatus, setKaliStatus] = useState<KaliStatusValue>(KaliStatus.IDLE);
  const [kaliError, setKaliError] = useState<KaliError | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [reasoningText, setReasoningText] = useState("");
  const [isReasoningStreaming, setIsReasoningStreaming] = useState(false);
  const reasoningRef = useRef("");
  const kaliStatusRef = useRef<KaliStatusValue>(KaliStatus.IDLE);

  const refresh = useCallback(() => {
    statusRef.current = game.getStatus();
    setStatusVersion((v) => v + 1);
  }, [game]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startGame = useCallback(() => {
    setRetryCount(0);
    setKaliStatus(KaliStatus.IDLE);
    setKaliError(null);
    kaliStatusRef.current = KaliStatus.IDLE;

    aiSlotFiller.clear(GameType.TIC_TAC_TOE, SlotId.OPPONENT);

    game.restart({
      slots: game.slots,
      rules: { starter, difficulty, mode },
    });

    if (mode === GameMode.CPU) {
      aiSlotFiller.fill(GameType.TIC_TAC_TOE, SlotId.OPPONENT, new TicTacToeCPUPlayer(difficulty));
    } else if (mode === GameMode.KALI) {
      if (chat.wsClient) {
        const kaliSlot = new AISlot(SlotId.OPPONENT, chat.wsClient);
        kaliSlot.setSessionId(game.sessionId);
        aiSlotFiller.fill(GameType.TIC_TAC_TOE, SlotId.OPPONENT, kaliSlot);
      }
    }

    refresh();
  }, [game, starter, difficulty, mode, systemStatus, chat, refresh]);

  useEffect(() => {
    if (statusRef.current !== GameStatus.PLAYING) return;
    const data = game.getState().data as TicTacToeData;
    if (data.currentSlot !== SlotId.OPPONENT) return;
    if (data.mode !== GameMode.KALI) return;

    const filler = aiSlotFiller.get(GameType.TIC_TAC_TOE, SlotId.OPPONENT);
    if (!filler) return;

    setKaliStatus(KaliStatus.THINKING);
    kaliStatusRef.current = KaliStatus.THINKING;
    setKaliError(null);
    setReasoningText("");
    reasoningRef.current = "";
    setIsReasoningStreaming(true);

    let cancelled = false;

    filler.decide(game.getState(), (chunk) => {
      if (cancelled) return;
      reasoningRef.current += chunk;
      setReasoningText(reasoningRef.current);
    }).then((action) => {
      if (cancelled) return;
      setIsReasoningStreaming(false);
      if (action.reasoning && reasoningRef.current.length === 0) {
        setReasoningText(action.reasoning);
      }
      kaliStatusRef.current = KaliStatus.IDLE;
      setKaliStatus(KaliStatus.IDLE);
      game.handleAction(action, SlotId.OPPONENT);
      refresh();
    }).catch((err: unknown) => {
      if (cancelled) return;
      setIsReasoningStreaming(false);
      const error = err instanceof KaliError ? err : new KaliError(
        "WS_ERROR",
        err instanceof Error ? err.message : String(err),
      );
      kaliStatusRef.current = KaliStatus.ERROR;
      setKaliStatus(KaliStatus.ERROR);
      setKaliError(error);
    });

    return () => {
      cancelled = true;
      setIsReasoningStreaming(false);
      kaliStatusRef.current = KaliStatus.IDLE;
      setKaliStatus(KaliStatus.IDLE);
    };
  }, [statusVersion, game, refresh, chat]);

  const handleKaliRetry = useCallback(() => {
    if (retryCount >= KALI_MAX_RETRIES) {
      handleFallbackToCPU();
      return;
    }
    setRetryCount((c) => c + 1);
    setKaliStatus(KaliStatus.THINKING);
    setKaliError(null);
    setReasoningText("");
    reasoningRef.current = "";
    setIsReasoningStreaming(true);
    kaliStatusRef.current = KaliStatus.THINKING;

    const filler = aiSlotFiller.get(GameType.TIC_TAC_TOE, SlotId.OPPONENT);
    if (!filler) return;

    filler.decide(game.getState(), (chunk) => {
      reasoningRef.current += chunk;
      setReasoningText(reasoningRef.current);
    }).then((action) => {
      setIsReasoningStreaming(false);
      if (action.reasoning && reasoningRef.current.length === 0) {
        setReasoningText(action.reasoning);
      }
      kaliStatusRef.current = KaliStatus.IDLE;
      setKaliStatus(KaliStatus.IDLE);
      game.handleAction(action, SlotId.OPPONENT);
      refresh();
    }).catch((err: unknown) => {
      setIsReasoningStreaming(false);
      const error = err instanceof KaliError ? err : new KaliError(
        "WS_ERROR",
        err instanceof Error ? err.message : String(err),
      );
      kaliStatusRef.current = KaliStatus.ERROR;
      setKaliStatus(KaliStatus.ERROR);
      setKaliError(error);
    });
  }, [game, refresh, retryCount]);

  const handleFallbackToCPU = useCallback(() => {
    const cpuPlayer = new TicTacToeCPUPlayer(difficulty);
    aiSlotFiller.fill(GameType.TIC_TAC_TOE, SlotId.OPPONENT, cpuPlayer);
    setMode(GameMode.CPU);
    setKaliStatus(KaliStatus.IDLE);
    setKaliError(null);
    kaliStatusRef.current = KaliStatus.IDLE;
    refresh();
  }, [difficulty, game, refresh]);

  const handleGiveUp = useCallback(() => {
    send(game, GameCommand.GIVE_UP);
    setKaliStatus(KaliStatus.IDLE);
    setKaliError(null);
    kaliStatusRef.current = KaliStatus.IDLE;
    refresh();
  }, [game, refresh]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
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
          send(game, GameCommand.PAUSE);
        } else if (status === GameStatus.PAUSED) {
          send(game, GameCommand.RESUME);
        }
        refresh();
        return;
      }

      if (status === GameStatus.WON || status === GameStatus.LOST || status === GameStatus.DRAW) {
        if (e.key === "Enter") {
          e.preventDefault();
          send(game, GameCommand.PLAY_AGAIN);
          refresh();
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [game, refresh, startGame]);

  const state = game.getState();
  const data = state.data as TicTacToeData | null;
  const board = data?.board ?? Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => null));
  const currentSlot = data?.currentSlot ?? SlotId.PLAYER;
  const winningLine = data?.winningLine;

  const isWinningCell = (row: number, col: number) => {
    return winningLine?.some(([r, c]) => r === row && c === col) ?? false;
  };

  const handleCellClick = (row: number, col: number) => {
    if (game.getStatus() !== GameStatus.PLAYING) return;
    if (kaliStatusRef.current === KaliStatus.THINKING) return;
    if (currentSlot !== SlotId.PLAYER) return;
    game.handleAction({ type: ActionType.MOVE, data: { row, col } }, SlotId.PLAYER);
    refresh();
  };

  const status = statusRef.current;

  return (
    <div
      className="relative rounded-2xl border-2"
      style={{
        backgroundColor: PALETTE.bg,
        borderColor: PALETTE.border,
        boxShadow: `0 0 24px ${PALETTE.borderGlow}, inset 0 0 18px rgba(56, 189, 248, 0.05)`,
        width: 320,
        minWidth: 320,
        maxWidth: 320,
        boxSizing: "border-box",
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-end justify-between px-1 pb-3 pt-3"
        style={{ width: 288, height: 46, margin: "0 auto", flex: "0 0 auto" }}
      >
        <span
          className="text-sm tracking-widest font-bold"
          style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.x, lineHeight: 1 }}
        >
          TA-TE-TI
        </span>
        <div
          className="px-2 py-1 rounded-md text-[9px]"
          style={{
            fontFamily: "'Press Start 2P', monospace",
            backgroundColor: "#0f172a",
            color: currentSlot === SlotId.PLAYER ? PALETTE.x : PALETTE.o,
            boxShadow: `0 0 8px ${currentSlot === SlotId.PLAYER ? PALETTE.xGlow : PALETTE.oGlow}`,
          }}
        >
          {currentSlot === SlotId.PLAYER
            ? "TU TURNO"
            : kaliStatus === KaliStatus.THINKING
              ? "KALI PENSANDO..."
              : "TURNO IA"}
        </div>
      </div>

      {/* Board grid */}
      <div
        className="grid rounded-xl p-2 mx-auto"
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

      {/* Reasoning panel */}
      {(reasoningText || isReasoningStreaming) && (
        <div
          className="mx-auto mt-3 rounded-lg p-2 transition-all duration-300"
          style={{
            width: 288,
            maxHeight: 96,
            overflowY: "auto",
            backgroundColor: "rgba(15, 23, 42, 0.75)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            boxSizing: "border-box",
          }}
        >
          <div
            className="text-[9px] mb-1 tracking-wider"
            style={{ fontFamily: "'Press Start 2P', monospace", color: "#38bdf8" }}
          >
            KALI PIENSA
          </div>
          <div
            className="text-[10px] leading-relaxed whitespace-pre-wrap break-words"
            style={{ color: "#94a3b8", lineHeight: 1.5 }}
          >
            {reasoningText}
            {isReasoningStreaming && (
              <span
                className="inline-block ml-0.5 animate-pulse"
                style={{ color: "#22d3ee" }}
              >
                ▌
              </span>
            )}
          </div>
        </div>
      )}

      {/* Waiting overlay */}
      {status === GameStatus.WAITING && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#02040a]/92 rounded-xl z-10 backdrop-blur-[2px]">
          <span className="text-5xl mb-3" style={{ filter: "drop-shadow(0 0 14px rgba(34,211,238,0.8))" }}>
            {"\u{2B1C}"}
          </span>
          <h2 className="text-xl mb-1 tracking-wider" style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.x }}>
            TA-TE-TI
          </h2>
          <p className="text-xs mb-4" style={{ fontFamily: "'Press Start 2P', monospace", color: "#38bdf8" }}>
            Tres en línea contra Kali o la CPU.
          </p>

          <div className="flex flex-col gap-3 mb-4">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px]" style={{ fontFamily: "'Press Start 2P', monospace", color: "#94a3b8" }}>
                MODO
              </span>
              <div className="flex gap-2">
                {([GameMode.CPU, GameMode.KALI] as GameModeValue[]).map((m) => {
                  const disabled = m === GameMode.KALI && !hasKali;
                  return (
                    <button
                      key={m}
                      onClick={() => !disabled && setMode(m)}
                      disabled={disabled}
                      className="px-3 py-2 rounded-md text-[10px] transition-all hover:brightness-110 hover:scale-105"
                      style={{
                        fontFamily: "'Press Start 2P', monospace",
                        backgroundColor: mode === m ? PALETTE.x : "#0f172a",
                        color: mode === m ? "#020617" : disabled ? "#475569" : "#94a3b8",
                        boxShadow: mode === m ? `0 0 12px ${PALETTE.xGlow}` : "none",
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {m === GameMode.CPU ? "VS CPU" : "VS KALI"}
                    </button>
                  );
                })}
              </div>
              {!hasKali && (
                <span className="text-[8px]" style={{ fontFamily: "'Press Start 2P', monospace", color: "#64748b" }}>
                  Conecta un proveedor de IA para jugar contra Kali
                </span>
              )}
            </div>

            {mode === GameMode.CPU && (
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px]" style={{ fontFamily: "'Press Start 2P', monospace", color: "#94a3b8" }}>
                  DIFICULTAD
                </span>
                <div className="flex gap-2">
                  {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className="px-3 py-2 rounded-md text-[10px] transition-all hover:brightness-110 hover:scale-105"
                      style={{
                        fontFamily: "'Press Start 2P', monospace",
                        backgroundColor: difficulty === d ? PALETTE.o : "#0f172a",
                        color: difficulty === d ? "#020617" : "#94a3b8",
                        boxShadow: difficulty === d ? `0 0 12px ${PALETTE.oGlow}` : "none",
                      }}
                    >
                      {d === "easy" ? "FÁCIL" : d === "medium" ? "MEDIO" : "DIFÍCIL"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px]" style={{ fontFamily: "'Press Start 2P', monospace", color: "#94a3b8" }}>
                EMPIEZA
              </span>
              <div className="flex gap-2">
                {([SlotId.PLAYER, SlotId.OPPONENT] as Starter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStarter(s)}
                    className="px-3 py-2 rounded-md text-[10px] transition-all hover:brightness-110 hover:scale-105"
                    style={{
                      fontFamily: "'Press Start 2P', monospace",
                      backgroundColor: starter === s ? PALETTE.x : "#0f172a",
                      color: starter === s ? "#020617" : "#94a3b8",
                      boxShadow: starter === s ? `0 0 12px ${PALETTE.xGlow}` : "none",
                    }}
                  >
                    {s === SlotId.PLAYER ? "TÚ" : "OPONENTE"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={startGame}
            className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
            style={{
              fontFamily: "'Press Start 2P', monospace",
              backgroundColor: PALETTE.x,
              color: "#020617",
              boxShadow: `0 0 14px ${PALETTE.xGlow}`,
            }}
          >
            START
          </button>
          <p className="text-[9px] mt-4" style={{ fontFamily: "'Press Start 2P', monospace", color: "#1e3a8a" }}>
            ENTER to start
          </p>
        </div>
      )}

      {/* Paused overlay */}
      {status === GameStatus.PAUSED && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#02040a]/85 rounded-xl z-10 backdrop-blur-[2px]">
          <h2 className="text-base mb-6 tracking-wider" style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.x }}>
            PAUSED
          </h2>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => { send(game, GameCommand.RESUME); refresh(); }}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", backgroundColor: PALETTE.x, color: "#020617", boxShadow: `0 0 14px ${PALETTE.xGlow}` }}
            >
              RESUME
            </button>
            <button
              onClick={() => { send(game, GameCommand.RESTART); refresh(); }}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", backgroundColor: "#1e3a8a", color: "#e0f2fe", border: "1px solid #38bdf8" }}
            >
              RESTART
            </button>
            <button
              onClick={() => { send(game, GameCommand.GIVE_UP); refresh(); }}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", color: "#e0f2fe", backgroundColor: "#7f1d1d", border: "1px solid #f87171" }}
            >
              QUIT
            </button>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {kaliStatus === KaliStatus.ERROR && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#02040a]/92 rounded-xl z-30 backdrop-blur-[2px]">
          <span className="text-4xl mb-3" style={{ filter: "drop-shadow(0 0 14px rgba(244,63,94,0.8))" }}>
            {"\u26A0"}
          </span>
          <h2 className="text-sm mb-2 text-center px-4" style={{ fontFamily: "'Press Start 2P', monospace", color: "#f43f5e" }}>
            ERROR
          </h2>
          <p className="text-[9px] mb-1 text-center px-6" style={{ fontFamily: "'Press Start 2P', monospace", color: "#fca5a5" }}>
            {kaliError?.message ?? "Error desconocido"}
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
              REINTENTAR
            </button>
            {retryCount >= 1 && (
              <p className="text-[8px] text-center" style={{ fontFamily: "'Press Start 2P', monospace", color: "#f59e0b" }}>
                ¡Último intento!
              </p>
            )}
            <button
              onClick={handleFallbackToCPU}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", backgroundColor: "#1e3a8a", color: "#e0f2fe", border: "1px solid #38bdf8" }}
            >
              CONTINUAR CON CPU
            </button>
            <button
              onClick={handleGiveUp}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", color: "#e0f2fe", backgroundColor: "#7f1d1d", border: "1px solid #f87171" }}
            >
              RENDIRSE
            </button>
          </div>
        </div>
      )}

      {/* Won/Lost/Draw overlay */}
      {(status === GameStatus.WON || status === GameStatus.LOST || status === GameStatus.DRAW) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#02040a]/92 rounded-xl z-10 backdrop-blur-[2px]">
          <h2
            className="text-lg mb-1 tracking-wider"
            style={{
              fontFamily: "'Press Start 2P', monospace",
              color: status === GameStatus.WON ? PALETTE.x : status === GameStatus.LOST ? "#f43f5e" : "#a78bfa",
              textShadow: `0 0 16px ${status === GameStatus.WON ? PALETTE.xGlow : status === GameStatus.LOST ? "rgba(244,63,94,0.7)" : "rgba(139,92,246,0.7)"}`,
            }}
          >
            {status === GameStatus.WON ? "GANASTE" : status === GameStatus.LOST ? "PERDISTE" : "EMPATE"}
          </h2>
          <div className="flex flex-col gap-3 mt-4">
            <button
              onClick={() => { send(game, GameCommand.PLAY_AGAIN); refresh(); }}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", backgroundColor: PALETTE.x, color: "#020617", boxShadow: `0 0 14px ${PALETTE.xGlow}` }}
            >
              PLAY AGAIN
            </button>
            <button
              onClick={() => { send(game, GameCommand.GIVE_UP); refresh(); }}
              className="px-5 py-2 rounded-lg transition-all text-xs tracking-wider hover:brightness-110 hover:scale-105"
              style={{ fontFamily: "'Press Start 2P', monospace", backgroundColor: "#1e3a8a", color: "#e0f2fe", border: "1px solid #38bdf8" }}
            >
              QUIT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
