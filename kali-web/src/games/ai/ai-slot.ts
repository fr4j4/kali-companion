import type { SlotIdValue } from "../core/constants/player-types";
import type { GameState } from "../core/types/game-state";
import type { GameAction } from "../core/types/game-action";
import { ActionType } from "../core/constants/action-types";
import type { WSClient } from "../../lib/wsClient";
import type { GameMoveResponseEvent } from "../../lib/protocol";
import { KaliError, fromGameMoveError } from "./kali-error";
import {
  KaliErrorCode,
  TttField,
  GAME_AI_TIMEOUT_MS,
  GAME_AI_TIMEOUT_2_MS,
  GAME_AI_TIMEOUT_3_MS,
  GAME_AI_GLOBAL_TIMEOUT_MS,
} from "../core/constants/game-ai";
import type { MoveProvider } from "./ai-slot-filler";

export class AISlot implements MoveProvider {
  private _abortController: AbortController | null = null;
  private _getGlobalTimeout: () => number = () => GAME_AI_GLOBAL_TIMEOUT_MS;

  constructor(
    private _slotId: SlotIdValue,
    private _wsClient: WSClient | null = null,
    private _getSessionId: () => string = () => "",
  ) {}

  get slotId(): SlotIdValue {
    return this._slotId;
  }

  get sessionId(): string {
    return this._getSessionId();
  }

  setSessionId(id: string) {
    this._getSessionId = () => id;
  }

  setGlobalTimeout(getter: () => number) {
    this._getGlobalTimeout = getter;
  }

  abort(): void {
    this._abortController?.abort();
  }

  async decide(
    context: GameState,
    _turnNumber: number = 0,
    onReasoning?: (chunk: string) => void,
  ): Promise<GameAction> {
    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();

    if (!this._wsClient) {
      throw new KaliError(
        KaliErrorCode.WS_NULL,
        "No WebSocket connection available",
      );
    }

    const gameSessionId = this._getSessionId();
    const data = context.data as Record<string, unknown>;
    const payload = {
      event: "game_move",
      game_type: "tictactoe",
      game_session_id: gameSessionId,
      rules: {
        system_prompt: this._buildSystemPrompt(data),
        response_format: "json",
      },
      game_state: data,
      player_role: this._slotId,
      difficulty: data[TttField.DIFFICULTY] as string | undefined,
      starter: data[TttField.STARTER] as string | undefined,
      player_marker: data[TttField.PLAYER_MARK] as string | undefined,
      opponent_marker: data[TttField.OPPONENT_MARK] as string | undefined,
    };

    const timeouts = [GAME_AI_TIMEOUT_MS, GAME_AI_TIMEOUT_2_MS, GAME_AI_TIMEOUT_3_MS];
    const globalTimeoutMs = this._getGlobalTimeout();
    let lastError: unknown;

    for (let attempt = 0; attempt < timeouts.length; attempt++) {
      const timeoutMs = timeouts[attempt]!;
      const reasoningChunks: string[] = [];
      let lastChunkAt = 0;

      // Register a dynamic listener for reasoning chunks during this attempt
      const reasoningPrefix = `game_move_reasoning:${gameSessionId}`;
      const unsubReasoning = this._wsClient.onDynamic(reasoningPrefix, (payload) => {
        const ev = payload as { chunk?: string; done?: boolean };
        if (ev.chunk) {
          reasoningChunks.push(ev.chunk);
          onReasoning?.(ev.chunk);
          lastChunkAt = performance.now();
        }
      });

      try {
        const response = await this._wsClient.sendAndWait<GameMoveResponseEvent>(
          payload,
          "game_move_response",
          timeoutMs,
          this._abortController.signal,
          {
            onProgress: () => {
              // noop: actual progress is driven by reasoning chunks above.
              // This callback exists so WSClient can reset its attempt timer
              // whenever reasoning activity is detected.
              void lastChunkAt;
            },
            globalTimeoutMs,
          },
        );

        unsubReasoning();

        const reasoning = response.reasoning ?? reasoningChunks.join("");

        if (response.error) {
          throw fromGameMoveError(
            response.error.code,
            response.error.message,
            response.error.fallback_action,
          );
        }

        if (response.action) {
          return {
            type: response.action.type as (typeof ActionType)[keyof typeof ActionType],
            data: response.action.data,
            reasoning,
          };
        }

        throw new KaliError(
          KaliErrorCode.NO_LEGAL_MOVES,
          "No hay movimientos disponibles. El tablero esta lleno.",
        );
      } catch (err) {
        unsubReasoning();
        lastError = err;

        if (err instanceof KaliError && err.code === KaliErrorCode.WS_ERROR && err.message.includes("aborted")) {
          throw err;
        }

        const isTimeout = err instanceof Error && err.message.includes("timed out");
        const isLastAttempt = attempt === timeouts.length - 1;

        if (isTimeout && !isLastAttempt) {
          continue;
        }

        if (isTimeout && isLastAttempt) {
          throw new KaliError(
            KaliErrorCode.WS_TIMEOUT,
            "Kali no pudo responder a tiempo. La conexion se perdio o el servidor no respondio.",
          );
        }

        throw new KaliError(
          KaliErrorCode.WS_ERROR,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    throw new KaliError(
      KaliErrorCode.WS_ERROR,
      lastError instanceof Error ? lastError.message : String(lastError),
    );
  }

  private _buildSystemPrompt(data: Record<string, unknown>): string {
    const difficulty = (data[TttField.DIFFICULTY] as string) ?? "medium";
    const opponentMarker = (data[TttField.OPPONENT_MARK] as string) ?? "O";
    const playerMarker = (data[TttField.PLAYER_MARK] as string) ?? "X";
    const currentSlot = data[TttField.CURRENT_SLOT] as string;
    const isMyTurn = currentSlot === this._slotId;

    const instructions: Record<string, string> = {
      easy: "You are a beginner. Make random but reasonable moves.",
      medium: "Try to win. Block opponent's winning moves when possible.",
      hard: "Play optimally using minimax strategy. Take winning moves immediately.",
    };
    const instruction = instructions[difficulty] ?? instructions.medium;

    const board = data[TttField.BOARD] as (string | null)[][];
    const empties = board
      .flatMap((row, r) => row.map((cell, c) => (cell === null ? `(${r},${c})` : null)))
      .filter((v): v is string => v !== null);
    const boardStr = board
      .map((row) => row.map((cell) => cell ?? "_").join(" | "))
      .map((line, r) => `row ${r}: ${line}`)
      .join("\n");

    return [
      "You are playing Tic-Tac-Toe.",
      `Your marker is ${opponentMarker}, opponent is ${playerMarker}.`,
      isMyTurn
        ? "It is YOUR turn. Choose an empty cell."
        : "Wait for the opponent to move.",
      instruction,
      `Current board (row 0-2, col 0-2):`,
      boardStr,
      empties.length > 0 ? `Empty cells: ${empties.join(",")}.` : "No empty cells.",
      "Respond with ONLY valid JSON, no markdown, no extra text:",
      `{"reasoning": "<one short sentence>", "row": <0-2>, "col": <0-2>}`,
    ].join("\n");
  }
}
