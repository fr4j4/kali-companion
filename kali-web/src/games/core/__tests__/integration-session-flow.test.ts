import type { BaseGame } from "../base-game";
import type { MoveProvider } from "../../ai/ai-slot-filler";
import type { GameAction } from "../types/game-action";
import type { GameStatusValue } from "../constants/game-status";
import type { GameTypeValue } from "../constants/game-types";
import type { SlotIdValue } from "../constants/player-types";
import type { GameSessionManagerCallbacks } from "../game-session-manager";

import { TurnBasedSessionManager } from "../turn-based-session-manager";
import { gameSessionStore } from "../game-session-store";
import { GAME_PARADIGM, GAME_ACTOR } from "../game-session-constants";
import { PlayerType, SlotId } from "../constants/player-types";
import { ActionType } from "../constants/action-types";

/**
 * Integration test: verifies the full session flow across a game.restart(),
 * ensuring the TurnBasedSessionManager registers turns in the NEW sessionId
 * (not the stale one) and that a panel using getSessionId() would see data.
 */
describe("Integration: session flow across restart", () => {
  vi.useFakeTimers();

  afterEach(() => {
    gameSessionStore.clearSession("session-initial");
    gameSessionStore.clearSession("session-restarted");
    gameSessionStore.clearSession("session-destroy-test");
  });

  function createMockGameWithMutableSessionId(): {
    game: BaseGame;
    setSessionId: (id: string) => void;
    setStatus: (s: string) => void;
    setCurrentSlot: (s: SlotIdValue) => void;
  } {
    const slots = [
      { id: SlotId.PLAYER, type: PlayerType.HUMAN, name: "Tú" },
      { id: SlotId.OPPONENT, type: PlayerType.AI, name: "Oponente" },
    ];
    let sessionId = "session-initial";
    let status = "waiting";
    let currentSlot: SlotIdValue = SlotId.PLAYER;
    let data: unknown = {
      currentSlot,
      board: [[null, null, null], [null, null, null], [null, null, null]],
    };

    const game = {
      type: "tictactoe" as GameTypeValue,
      paradigm: GAME_PARADIGM.TURN_BASED,
      slots,
      get sessionId() {
        return sessionId;
      },
      getState: () => ({ status, data, score: 0, winner: null }),
      getStatus: () => status as GameStatusValue,
      handleAction: (action: GameAction, fromSlotId: string) => {
        if (
          action.type === ActionType.MOVE &&
          typeof action.data === "object" &&
          action.data !== null
        ) {
          const { row, col } = action.data as { row: number; col: number };
          const board = (data as { board: (string | null)[][] }).board;
          board[row][col] = fromSlotId === SlotId.PLAYER ? "X" : "O";
        }
        currentSlot =
          currentSlot === SlotId.PLAYER
            ? (SlotId.OPPONENT as typeof currentSlot)
            : SlotId.PLAYER;
        data = { ...(data as object), currentSlot };
        status = "playing";
        return game.getState();
      },
      pause: () => {
        status = "paused";
      },
      resume: () => {
        status = "playing";
      },
    } as unknown as BaseGame;

    return {
      game,
      setSessionId: (id: string) => {
        sessionId = id;
      },
      setStatus: (s: string) => {
        status = s;
      },
      setCurrentSlot: (s: SlotIdValue) => {
        currentSlot = s;
        data = { ...(data as object), currentSlot: s };
      },
    };
  }

  function createStreamingProvider(chunks: string[], action: GameAction): MoveProvider {
    return {
      async decide(_state, _turnNumber, onReasoning) {
        for (const chunk of chunks) {
          onReasoning?.(chunk);
        }
        return action;
      },
      abort: vi.fn(),
    };
  }

  function createManager(
    game: BaseGame,
    provider: MoveProvider,
  ): TurnBasedSessionManager {
    const providers = new Map<SlotIdValue, MoveProvider>([
      [SlotId.OPPONENT, provider],
    ]);
    const callbacks: GameSessionManagerCallbacks = {
      onStateChange: vi.fn(),
      onAIStatusChange: vi.fn(),
    };
    return new TurnBasedSessionManager(game, providers, callbacks);
  }

  it("registers AI turn reasoning in the new sessionId after restart, not the old one", async () => {
    const { game, setSessionId, setStatus, setCurrentSlot } =
      createMockGameWithMutableSessionId();

    const aiAction: GameAction = { type: ActionType.MOVE, data: { row: 1, col: 1 } };
    const provider = createStreamingProvider(
      ["I should ", "take the center."],
      aiAction,
    );

    // Simulate initial game.start() → session-initial
    gameSessionStore.startSession("session-initial", "tictactoe", GAME_PARADIGM.TURN_BASED);

    // Simulate game.restart() → session-restarted
    setSessionId("session-restarted");
    setStatus("playing");
    setCurrentSlot(SlotId.PLAYER);
    gameSessionStore.startSession("session-restarted", "tictactoe", GAME_PARADIGM.TURN_BASED);

    // Create manager with the game (session is already "session-restarted")
    const manager = createManager(game, provider);

    // Player makes a move
    manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });

    // Flush async (AI turn triggered)
    await vi.runAllTimersAsync();

    // The new session should have both turns
    const newTurns = gameSessionStore.getTurns("session-restarted");
    expect(newTurns).toHaveLength(2);
    expect(newTurns[0].actor).toBe(GAME_ACTOR.PLAYER);
    expect(newTurns[1].actor).toBe(GAME_ACTOR.AI);

    // The AI turn should have reasoning accumulated and finalized
    const aiTurns = gameSessionStore.getAITurns("session-restarted");
    expect(aiTurns).toHaveLength(1);
    expect(aiTurns[0].reasoning?.text).toBe("I should take the center.");
    expect(aiTurns[0].reasoning?.done).toBe(true);

    // The action and stateAfter should be the real ones (not placeholder)
    expect(aiTurns[0].action).toEqual(aiAction);
    const stateAfter = aiTurns[0].stateAfter as { board: (string | null)[][] };
    expect(stateAfter.board[1][1]).toBe("O");

    // The old session should be empty (no turns registered there)
    const oldTurns = gameSessionStore.getTurns("session-initial");
    expect(oldTurns).toHaveLength(0);

    // A panel using getSessionId() (dynamic) would see data — simulating what
    // GameReasoningPanel and GameDebugPanel do after the fix.
    const dynamicSid = game.sessionId;
    expect(dynamicSid).toBe("session-restarted");
    expect(gameSessionStore.getAITurns(dynamicSid)).toHaveLength(1);

    // A panel using a STALE sessionId would NOT see data — this was the original bug.
    expect(gameSessionStore.getAITurns("session-initial")).toHaveLength(0);
  });

  it("destroy() aborts the active provider and prevents action application", async () => {
    const { game, setSessionId, setStatus, setCurrentSlot } =
      createMockGameWithMutableSessionId();

    let resolveDecide: ((action: GameAction) => void) | null = null;
    const pendingPromise = new Promise<GameAction>((r) => {
      resolveDecide = r as ((action: GameAction) => void);
    });

    const provider: MoveProvider = {
      async decide() {
        return pendingPromise;
      },
      abort: vi.fn(),
    };

    setSessionId("session-destroy-test");
    setStatus("playing");
    setCurrentSlot(SlotId.PLAYER);
    gameSessionStore.startSession("session-destroy-test", "tictactoe", GAME_PARADIGM.TURN_BASED);

    const manager = createManager(game, provider);

    // Player moves → triggers AI turn
    manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });

    // Flush microtasks to let _triggerAITurn start
    await vi.advanceTimersByTimeAsync(1);

    // Destroy manager while decide() is still pending
    manager.destroy();

    // Provider.abort() should have been called
    expect(provider.abort).toHaveBeenCalled();

    // Now resolve decide() — the manager should NOT apply the action
    const resolve = resolveDecide as ((action: GameAction) => void) | null;
    resolve?.({ type: ActionType.MOVE, data: { row: 2, col: 2 } });

    await vi.runAllTimersAsync();

    // The AI turn placeholder should exist but action should NOT have been completed
    const turns = gameSessionStore.getTurns("session-destroy-test");
    const aiTurn = turns.find((t) => t.actor === GAME_ACTOR.AI);
    expect(aiTurn).toBeDefined();
    // The action is still the placeholder (not the resolved action)
    expect(aiTurn?.action).toEqual({ type: "move", data: {} });

    // The board should NOT have the AI's move at [2][2]
    const state = game.getState().data as { board: (string | null)[][] };
    expect(state.board[2][2]).toBeNull();
  });
});