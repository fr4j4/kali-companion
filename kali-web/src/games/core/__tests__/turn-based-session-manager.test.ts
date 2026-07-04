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
import { ActionType, GameCommand } from "../constants/action-types";
import { KaliStatus, KALI_MAX_RETRIES } from "../constants/game-ai";
import { KaliError } from "../../ai/kali-error";

function createMockGame(overrides?: Partial<BaseGame>): BaseGame {
  const slots = [
    { id: SlotId.PLAYER, type: PlayerType.HUMAN, name: "Tú" },
    { id: SlotId.OPPONENT, type: PlayerType.AI, name: "Oponente" },
  ];
  let status = "waiting";
  let currentSlot = SlotId.PLAYER;
  let data: unknown = { currentSlot, board: [[null, null, null], [null, null, null], [null, null, null]] };

  const game = {
    type: "tictactoe" as GameTypeValue,
    paradigm: GAME_PARADIGM.TURN_BASED,
    slots,
    sessionId: "session-1",
    getState: () => ({ status, data, score: 0, winner: null }),
    getStatus: () => status as GameStatusValue,
    isFinished: () => status !== "playing" && status !== "paused" && status !== "waiting",
    handleAction: (action: GameAction, fromSlotId: string) => {
      if (action.type === ActionType.MOVE && typeof action.data === "object" && action.data !== null) {
        const { row, col } = action.data as { row: number; col: number };
        const board = (data as any).board as (string | null)[][];
        board[row][col] = fromSlotId === SlotId.PLAYER ? "X" : "O";
      }
      currentSlot = currentSlot === SlotId.PLAYER ? (SlotId.OPPONENT as typeof currentSlot) : SlotId.PLAYER;
      data = { ...(data as object), currentSlot };
      status = "playing";
      return game.getState();
    },
    pause: () => { status = "paused"; },
    resume: () => { status = "playing"; },
    ...overrides,
  } as unknown as BaseGame;
  return game;
}

function createMockProvider(opts: {
  action?: GameAction;
  chunks?: string[];
  delay?: number;
  error?: Error;
} = {}): MoveProvider {
  return {
    async decide(_state, _turnNumber, onReasoning) {
      if (opts.error) throw opts.error;
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      for (const chunk of opts.chunks ?? []) {
        onReasoning?.(chunk);
      }
      return opts.action ?? { type: ActionType.MOVE, data: { row: 0, col: 0 } };
    },
    abort: vi.fn(),
  };
}

function createManager(
  game: BaseGame,
  provider: MoveProvider,
  callbacks: Partial<GameSessionManagerCallbacks> = {},
) {
  const providers = new Map<SlotIdValue, MoveProvider>([[SlotId.OPPONENT, provider]]);
  const cb: GameSessionManagerCallbacks = {
    onStateChange: vi.fn(),
    onAIStatusChange: vi.fn(),
    ...callbacks,
  };
  const manager = new TurnBasedSessionManager(game, providers, cb);
  return { manager, callbacks: cb };
}

describe("TurnBasedSessionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gameSessionStore.clearSession("session-1");
    gameSessionStore.startSession("session-1", "tictactoe", GAME_PARADIGM.TURN_BASED);
  });

  afterEach(() => {
    vi.useRealTimers();
    gameSessionStore.clearSession("session-1");
  });

  describe("submitPlayerAction", () => {
    it("applies the action, registers a player turn, and triggers the AI turn", async () => {
      const game = createMockGame();
      const action: GameAction = { type: ActionType.MOVE, data: { row: 0, col: 0 } };
      const aiAction: GameAction = { type: ActionType.MOVE, data: { row: 1, col: 1 } };
      const provider = createMockProvider({ action: aiAction });
      const { manager, callbacks } = createManager(game, provider);

      manager.submitPlayerAction(action);

      expect((game.getState().data as any).board[0][0]).toBe("X");
      expect(callbacks.onStateChange).toHaveBeenCalled();

      const turnsBefore = gameSessionStore.getTurns("session-1");
      expect(turnsBefore[0]).toMatchObject({
        turnNumber: 1,
        slotId: SlotId.PLAYER,
        actor: GAME_ACTOR.PLAYER,
        action,
      });

      await vi.runAllTimersAsync();

      const turns = gameSessionStore.getTurns("session-1");
      expect(turns).toHaveLength(2);
      expect(turns[1]).toMatchObject({
        turnNumber: 2,
        slotId: SlotId.OPPONENT,
        actor: GAME_ACTOR.AI,
        action: aiAction,
      });
      expect(callbacks.onStateChange).toHaveBeenCalledTimes(2);
    });
  });

  describe("triggerAITurn", () => {
    it("creates the AI placeholder turn before decide resolves and accumulates reasoning chunks", async () => {
      const game = createMockGame();
      const aiAction: GameAction = { type: ActionType.MOVE, data: { row: 2, col: 2 } };
      const captured: {
        turnNumber?: number;
        placeholderDuringDecide?: ReturnType<typeof gameSessionStore.getTurns>[number];
        reasoningTextDuring?: string;
      } = {};
      const provider: MoveProvider = {
        async decide(_state, turnNumber, onReasoning) {
          const turns = gameSessionStore.getTurns("session-1");
          const placeholder = turns.find((t) => t.turnNumber === turnNumber);
          captured.turnNumber = turnNumber;
          captured.placeholderDuringDecide = placeholder;
          await new Promise((r) => setTimeout(r, 50));
          onReasoning?.("thinking");
          onReasoning?.(" about");
          onReasoning?.(" move");
          captured.reasoningTextDuring = gameSessionStore
            .getTurns("session-1")
            .find((t) => t.turnNumber === turnNumber)?.reasoning?.text;
          await new Promise((r) => setTimeout(r, 50));
          return aiAction;
        },
        abort: vi.fn(),
      };

      const { manager, callbacks } = createManager(game, provider);
      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });

      await vi.advanceTimersByTimeAsync(1);

      expect(captured.turnNumber).toBe(2);
      expect(captured.placeholderDuringDecide).toBeDefined();
      expect(captured.placeholderDuringDecide?.actor).toBe(GAME_ACTOR.AI);
      expect(captured.placeholderDuringDecide?.reasoning?.done).toBe(false);
      expect(captured.placeholderDuringDecide?.reasoning?.text).toBe("");

      await vi.runAllTimersAsync();

      expect(captured.reasoningTextDuring).toBe("thinking about move");
      expect(callbacks.onAIStatusChange).toHaveBeenCalledWith(KaliStatus.THINKING, undefined);
      expect(callbacks.onAIStatusChange).toHaveBeenCalledWith(KaliStatus.IDLE, undefined);

      const turns = gameSessionStore.getTurns("session-1");
      const aiTurn = turns.find((t) => t.actor === GAME_ACTOR.AI);
      expect(aiTurn?.action).toEqual(aiAction);
      expect(aiTurn?.reasoning?.text).toBe("thinking about move");
      expect(aiTurn?.reasoning?.done).toBe(true);
      expect((aiTurn?.stateAfter as any).board[2][2]).toBe("O");
      expect(callbacks.onStateChange).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("reports ERROR via onAIStatusChange when decide throws", async () => {
      const game = createMockGame();
      const provider = createMockProvider({ error: new Error("decide failed") });
      const { manager, callbacks } = createManager(game, provider);

      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });
      await vi.runAllTimersAsync();

      expect(callbacks.onAIStatusChange).toHaveBeenCalledWith(KaliStatus.THINKING, undefined);
      expect(callbacks.onAIStatusChange).toHaveBeenCalledWith(
        KaliStatus.ERROR,
        expect.objectContaining({ message: "decide failed" }),
      );
      expect(manager.kaliStatus).toBe(KaliStatus.ERROR);
      expect(manager.kaliError).toBeInstanceOf(KaliError);
      expect(manager.kaliError?.message).toBe("decide failed");
    });

    it("retryAI increments retryCount and re-triggers the AI turn", async () => {
      const game = createMockGame();
      const provider = createMockProvider({ error: new Error("still failing") });
      const { manager, callbacks } = createManager(game, provider);

      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });
      await vi.runAllTimersAsync();
      expect(manager.retryCount).toBe(0);

      manager.retryAI();
      await vi.runAllTimersAsync();
      expect(manager.retryCount).toBe(1);
      expect(callbacks.onAIStatusChange).toHaveBeenCalledWith(KaliStatus.THINKING, undefined);
      expect(callbacks.onAIStatusChange).toHaveBeenCalledWith(
        KaliStatus.ERROR,
        expect.objectContaining({ message: "still failing" }),
      );
    });

    it("does not retry when retryCount reaches KALI_MAX_RETRIES", async () => {
      const game = createMockGame();
      const provider = createMockProvider({ error: new Error("still failing") });
      const decideSpy = vi.fn(provider.decide);
      provider.decide = decideSpy;
      const { manager } = createManager(game, provider);

      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });
      await vi.runAllTimersAsync();

      manager.retryAI();
      await vi.runAllTimersAsync();
      manager.retryAI();
      await vi.runAllTimersAsync();

      expect(manager.retryCount).toBe(KALI_MAX_RETRIES);
      expect(decideSpy).toHaveBeenCalledTimes(1 + KALI_MAX_RETRIES);

      manager.retryAI();
      await vi.runAllTimersAsync();

      expect(manager.retryCount).toBe(KALI_MAX_RETRIES);
      expect(decideSpy).toHaveBeenCalledTimes(1 + KALI_MAX_RETRIES);
    });

    it("fallbackToCPU replaces the provider and resets retryCount", async () => {
      const game = createMockGame();
      const failingProvider = createMockProvider({ error: new Error("still failing") });
      const cpuAction: GameAction = { type: ActionType.MOVE, data: { row: 2, col: 0 } };
      const cpuProvider = createMockProvider({ action: cpuAction });
      const { manager, callbacks } = createManager(game, failingProvider);

      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });
      await vi.runAllTimersAsync();
      expect(manager.retryCount).toBe(0);

      manager.retryAI();
      await vi.runAllTimersAsync();
      expect(manager.retryCount).toBe(1);
      expect(manager.kaliStatus).toBe(KaliStatus.ERROR);

      manager.fallbackToCPU(cpuProvider);
      expect(manager.retryCount).toBe(0);

      manager.retryAI();
      await vi.runAllTimersAsync();

      expect(manager.kaliStatus).toBe(KaliStatus.IDLE);
      expect(callbacks.onAIStatusChange).toHaveBeenCalledWith(KaliStatus.IDLE, undefined);

      const turns = gameSessionStore.getTurns("session-1");
      const aiTurn = turns.find((t) => t.actor === GAME_ACTOR.AI && t.action.data && Object.keys(t.action.data as object).length > 0);
      expect(aiTurn?.action).toEqual(cpuAction);
    });
  });

  describe("lifecycle", () => {
    it("pause and resume call game pause/resume and onStateChange", async () => {
      const game = createMockGame();
      const provider = createMockProvider();
      const { manager, callbacks } = createManager(game, provider);

      manager.pause();
      expect(game.getStatus()).toBe("paused");
      expect(callbacks.onStateChange).toHaveBeenCalledTimes(1);

      manager.resume();
      expect(game.getStatus()).toBe("playing");
      expect(callbacks.onStateChange).toHaveBeenCalledTimes(2);
    });

    it("giveUp sends a GIVE_UP command via the human slot", async () => {
      const game = createMockGame();
      const provider = createMockProvider();
      const { manager, callbacks } = createManager(game, provider);
      const handleActionSpy = vi.spyOn(game, "handleAction");

      manager.giveUp();

      expect(handleActionSpy).toHaveBeenCalledWith(
        { type: ActionType.COMMAND, data: GameCommand.GIVE_UP },
        SlotId.PLAYER,
      );
      expect(callbacks.onStateChange).toHaveBeenCalled();
    });

    it("destroy prevents a delayed AI action from being applied", async () => {
      const game = createMockGame();
      const delayedAction: GameAction = { type: ActionType.MOVE, data: { row: 2, col: 2 } };
      const provider = createMockProvider({ action: delayedAction, delay: 200 });
      const { manager } = createManager(game, provider);

      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });
      await vi.advanceTimersByTimeAsync(50);

      const turnsBeforeDestroy = gameSessionStore.getTurns("session-1");
      expect(turnsBeforeDestroy).toHaveLength(2);

      manager.destroy();

      await vi.runAllTimersAsync();

      const turns = gameSessionStore.getTurns("session-1");
      expect(turns).toHaveLength(2);
      expect((game.getState().data as any).board[2][2]).toBeNull();
    });
  });

  describe("subscribe", () => {
    it("notifies subscribers and returns a working unsubscribe", () => {
      const game = createMockGame();
      const provider = createMockProvider();
      const { manager } = createManager(game, provider);
      const subscriber = vi.fn();

      const unsubscribe = manager.subscribe(subscriber);
      expect(subscriber).not.toHaveBeenCalled();

      manager.pause();
      expect(subscriber).toHaveBeenCalled();

      unsubscribe();
      subscriber.mockClear();
      manager.resume();
      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe("getters", () => {
    it("kaliStatus, kaliError and retryCount reflect internal state", async () => {
      const game = createMockGame();
      const provider = createMockProvider({ error: new Error("boom") });
      const { manager } = createManager(game, provider);

      expect(manager.kaliStatus).toBe(KaliStatus.IDLE);
      expect(manager.kaliError).toBeNull();
      expect(manager.retryCount).toBe(0);

      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });
      await vi.runAllTimersAsync();

      expect(manager.kaliStatus).toBe(KaliStatus.ERROR);
      expect(manager.kaliError).toBeInstanceOf(KaliError);
      expect(manager.retryCount).toBe(0);

      manager.retryAI();
      await vi.runAllTimersAsync();
      expect(manager.retryCount).toBe(1);
    });
  });

  describe("isFinished guard", () => {
    it("does not invoke provider.decide() when the game is finished", async () => {
      const game = createMockGame({
        getStatus: () => "won" as GameStatusValue,
        isFinished: () => true,
      });
      const provider = createMockProvider();
      const decideSpy = vi.spyOn(provider, "decide");
      const { manager } = createManager(game, provider);

      // Even if the AI slot is "current", the manager must not trigger a turn.
      manager.submitPlayerAction({ type: ActionType.MOVE, data: { row: 0, col: 0 } });
      await vi.runAllTimersAsync();

      expect(decideSpy).not.toHaveBeenCalled();
    });

    it("does not invoke provider.decide() on retryAI when the game is finished", async () => {
      const game = createMockGame({
        getStatus: () => "draw" as GameStatusValue,
        isFinished: () => true,
      });
      const provider = createMockProvider();
      const decideSpy = vi.spyOn(provider, "decide");
      const { manager } = createManager(game, provider);

      manager.retryAI();
      await vi.runAllTimersAsync();

      expect(decideSpy).not.toHaveBeenCalled();
    });
  });
});
