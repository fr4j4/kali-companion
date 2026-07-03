import { createGameSessionManager } from "../game-session-manager";
import { TurnBasedSessionManager } from "../turn-based-session-manager";
import { RealtimeSessionManager } from "../realtime-session-manager";
import { GAME_PARADIGM } from "../game-session-constants";
import type { BaseGame } from "../base-game";
import type { MoveProvider } from "../../ai/ai-slot-filler";
import type { GameAction } from "../types/game-action";
import type { GameState } from "../types/game-state";

function createMockGame(paradigm: "turn-based" | "realtime" | "unknown"): BaseGame {
  return {
    paradigm,
    type: "tictactoe",
    slots: [],
    sessionId: "mock-session",
    getState: vi.fn((): GameState => ({ status: "waiting", score: 0, data: null, winner: null })),
    handleAction: vi.fn((_action: GameAction, _fromSlotId: string): GameState => ({
      status: "playing",
      score: 0,
      data: null,
      winner: null,
    })),
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as BaseGame;
}

const noopCallbacks = {
  onStateChange: vi.fn(),
  onAIStatusChange: vi.fn(),
};

import type { SlotIdValue } from "../constants/player-types";

const emptyProviders = new Map<SlotIdValue, MoveProvider>();

describe("createGameSessionManager", () => {
  it("returns TurnBasedSessionManager for paradigm 'turn-based'", () => {
    const manager = createGameSessionManager(
      createMockGame(GAME_PARADIGM.TURN_BASED as "turn-based"),
      emptyProviders,
      noopCallbacks,
    );
    expect(manager).toBeInstanceOf(TurnBasedSessionManager);
  });

  it("returns RealtimeSessionManager for paradigm 'realtime'", () => {
    const manager = createGameSessionManager(
      createMockGame(GAME_PARADIGM.REALTIME as "realtime"),
      emptyProviders,
      noopCallbacks,
    );
    expect(manager).toBeInstanceOf(RealtimeSessionManager);
  });

  it("throws for unknown paradigm", () => {
    expect(() =>
      createGameSessionManager(
        createMockGame("unknown" as "turn-based"),
        emptyProviders,
        noopCallbacks,
      ),
    ).toThrow("Unsupported game paradigm: unknown");
  });
});

describe("RealtimeSessionManager stub behavior", () => {
  let manager: RealtimeSessionManager;
  let game: BaseGame;

  beforeEach(() => {
    game = createMockGame(GAME_PARADIGM.REALTIME as "realtime");
    manager = createGameSessionManager(game, emptyProviders, noopCallbacks) as RealtimeSessionManager;
  });

  it("submitPlayerAction throws a descriptive Error", () => {
    expect(() => manager.submitPlayerAction({ type: "move", data: {} })).toThrow(
      "submitPlayerAction is not implemented for realtime games",
    );
  });

  it("retryAI throws a descriptive Error", () => {
    expect(() => manager.retryAI()).toThrow("retryAI is not implemented for realtime games");
  });

  it("fallbackToCPU throws a descriptive Error", () => {
    expect(() => manager.fallbackToCPU({ decide: vi.fn() } as unknown as MoveProvider)).toThrow(
      "fallbackToCPU is not implemented for realtime games",
    );
  });

  it("kaliStatus is IDLE, kaliError is null, retryCount is 0", () => {
    expect(manager.kaliStatus).toBe("idle");
    expect(manager.kaliError).toBeNull();
    expect(manager.retryCount).toBe(0);
  });

  it("pause, resume, giveUp, destroy, start, subscribe do not throw", () => {
    expect(() => manager.pause()).not.toThrow();
    expect(() => manager.resume()).not.toThrow();
    expect(() => manager.giveUp()).not.toThrow();
    expect(() => manager.destroy()).not.toThrow();
    expect(() => manager.start()).not.toThrow();
    expect(() => manager.subscribe(() => {})).not.toThrow();
  });
});
