import type { SlotIdValue } from "../core/constants/player-types";
import type { GameState } from "../core/types/game-state";
import type { GameAction } from "../core/types/game-action";
import { ActionType } from "../core/constants/action-types";
import type { WSClient } from "../../lib/wsClient";
import type { GameMoveResponseEvent } from "../../lib/protocol";
import { KaliError, fromGameMoveError } from "./kali-error";
import { KaliErrorCode, TttField, GAME_AI_TIMEOUT_MS, GAME_AI_TIMEOUT_2_MS, GAME_AI_TIMEOUT_3_MS } from "../core/constants/game-ai";
import { gameAILogger } from "../core/game-ai-logger";

export class AISlot {
  private _abortController: AbortController | null = null;

  constructor(
    private _slotId: SlotIdValue,
    private _wsClient: WSClient | null = null,
    private _gameSessionId: string = "",
  ) {
    gameAILogger.startSession(this._gameSessionId);
  }

  get slotId(): SlotIdValue {
    return this._slotId;
  }

  setSessionId(id: string) {
    this._gameSessionId = id;
    gameAILogger.startSession(id);
  }

  async decide(context: GameState): Promise<GameAction> {
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

    const data = context.data as Record<string, unknown>;
    const payload = {
      event: "game_move",
      game_type: "tictactoe",
      game_session_id: this._gameSessionId,
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
    let lastError: unknown;

    for (let attempt = 0; attempt < timeouts.length; attempt++) {
      const timeoutMs = timeouts[attempt]!;
      try {
        gameAILogger.log("→", "game_move", payload);

        const response = await this._wsClient.sendAndWait<GameMoveResponseEvent>(
          payload,
          "game_move_response",
          timeoutMs,
          this._abortController.signal,
        );

        gameAILogger.log("←", "game_move_response", response);

        if (response.error) {
          throw fromGameMoveError(
            response.error.code,
            response.error.message,
            response.error.fallback_action,
          );
        }

        if (response.action) {
          console.info(
            `[AISlot] move decided | attempt=${attempt + 1} | action=%o`,
            response.action,
          );
          return {
            type: response.action.type as (typeof ActionType)[keyof typeof ActionType],
            data: response.action.data,
          };
        }

        throw new KaliError(
          KaliErrorCode.NO_LEGAL_MOVES,
          "No hay movimientos disponibles. El tablero esta lleno.",
        );
      } catch (err) {
        lastError = err;

        if (err instanceof KaliError && err.code === KaliErrorCode.WS_ERROR && err.message.includes("aborted")) {
          console.info("[AISlot] request aborted — new game started");
          throw err;
        }

        const isTimeout = err instanceof Error && err.message.includes("timed out");
        const isLastAttempt = attempt === timeouts.length - 1;

        if (isTimeout && !isLastAttempt) {
          console.warn(`[AISlot] timeout, retrying | attempt=${attempt + 1}/${timeouts.length}`);
          continue;
        }

        if (isTimeout && isLastAttempt) {
          console.error(`[AISlot] all retries exhausted after ${timeouts.length} attempts`);
          throw new KaliError(
            KaliErrorCode.WS_TIMEOUT,
            "Kali no pudo responder a tiempo. La conexion se perdio o el servidor no respondio.",
          );
        }

        console.error("[AISlot] sendAndWait error:", err);
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
    const starter = data[TttField.STARTER] as string;

    const instructions: Record<string, string> = {
      easy: "You are a beginner. Make random but reasonable moves.",
      medium: "Try to win. Block opponent's winning moves when possible.",
      hard: "Play optimally using minimax strategy. Take winning moves immediately.",
    };
    const instruction = instructions[difficulty] ?? instructions.medium;

    const board = data[TttField.BOARD] as (string | null)[][];
    const boardStr = board
      .map((row) => row.map((cell) => cell ?? "_").join(" | "))
      .map((line, r) => `row ${r}: ${line}`)
      .join("\n");

    return [
      "You are playing Tic-Tac-Toe.",
      `Your marker is ${opponentMarker}, opponent is ${playerMarker}.`,
      starter === "opponent" ? "You go first." : "Opponent (X) goes first.",
      instruction,
      `Current board (row 0-2, col 0-2):`,
      boardStr,
      "Output ONLY valid JSON with the row (0-2) and column (0-2) of your move.",
      '{"row": <number>, "col": <number>}',
    ].join("\n");
  }
}
