import { GameSessionStore, GAME_SESSION_RETENTION } from "../game-session-store";
import {
  GAME_PARADIGM,
  GAME_ACTOR,
  GAME_SESSION_WS_EVENT,
  PLACEHOLDER_AI_ACTION,
} from "../game-session-constants";
import { ActionType } from "../constants/action-types";
import type { GameTurnData, GameEventData } from "../game-session-types";
import type { WSClient } from "../../../lib/wsClient";

describe("GameSessionStore", () => {
  let store: GameSessionStore;
  let wsClient: WSClient;

  beforeEach(() => {
    store = new GameSessionStore();
    wsClient = { send: vi.fn() } as unknown as WSClient;
    store.setWSClient(wsClient);
  });

  describe("startSession", () => {
    it("creates a turn-based session with empty turns", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      const session = store.getSession("s1");
      expect(session).toBeDefined();
      expect(session?.paradigm).toBe("turn-based");
      expect(session?.turns).toEqual([]);
    });

    it("creates a realtime session with empty events", () => {
      store.startSession("s2", "snake", GAME_PARADIGM.REALTIME);
      const session = store.getSession("s2");
      expect(session).toBeDefined();
      expect(session?.paradigm).toBe("realtime");
      expect(session?.events).toEqual([]);
    });

    it("emits to subscribers", () => {
      const fn = vi.fn();
      store.subscribe(fn);
      store.startSession("s3", "chess", GAME_PARADIGM.TURN_BASED);
      expect(fn).toHaveBeenCalled();
    });

    it("sends WS event game_session_start", () => {
      store.startSession("s4", "connect4", GAME_PARADIGM.TURN_BASED);
      expect(wsClient.send).toHaveBeenCalledWith({
        event: GAME_SESSION_WS_EVENT.START,
        sessionId: "s4",
        gameId: "connect4",
        paradigm: GAME_PARADIGM.TURN_BASED,
      });
    });
  });

  describe("addTurn", () => {
    it("pushes a turn and emits", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      const fn = vi.fn();
      store.subscribe(fn);
      fn.mockClear();

      const turn: GameTurnData = {
        turnId: "t1",
        turnNumber: 1,
        slotId: "player",
        actor: GAME_ACTOR.PLAYER,
        action: { type: ActionType.MOVE, data: { index: 4 } },
        stateAfter: { board: [null, null, null, null, "X", null, null, null, null] },
        timestamp: Date.now(),
      };

      store.addTurn("s1", turn);
      expect(store.getTurns("s1")).toEqual([turn]);
      expect(fn).toHaveBeenCalled();
    });

    it("does nothing if session missing", () => {
      const turn: GameTurnData = {
        turnId: "t1",
        turnNumber: 1,
        slotId: "player",
        actor: GAME_ACTOR.PLAYER,
        action: { type: ActionType.MOVE, data: {} },
        stateAfter: null,
        timestamp: Date.now(),
      };
      expect(() => store.addTurn("missing", turn)).not.toThrow();
      expect(store.getTurns("missing")).toEqual([]);
      expect(wsClient.send).not.toHaveBeenCalled();
    });

    it("sends WS event game_turn", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      const turn: GameTurnData = {
        turnId: "t2",
        turnNumber: 2,
        slotId: "ai",
        actor: GAME_ACTOR.AI,
        action: PLACEHOLDER_AI_ACTION,
        stateAfter: { currentSlot: "player" },
        timestamp: 123,
        reasoning: { text: "", done: false },
      };
      store.addTurn("s1", turn);
      expect(wsClient.send).toHaveBeenCalledWith({
        event: GAME_SESSION_WS_EVENT.TURN,
        sessionId: "s1",
        turnData: turn,
      });
    });
  });

  describe("updateTurnReasoning", () => {
    it("accumulates chunks in the correct turn by turnNumber", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      store.addTurn("s1", createAITurn(1));

      store.updateTurnReasoning("s1", 1, "Thinking...");
      store.updateTurnReasoning("s1", 1, " Done");

      const turn = store.getTurns("s1")[0];
      expect(turn.reasoning?.text).toBe("Thinking... Done");
    });

    it("does nothing if turn does not exist", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      expect(() => store.updateTurnReasoning("s1", 99, "chunk")).not.toThrow();
      expect(store.getTurns("s1")).toEqual([]);
    });

    it("emits on each chunk", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      store.addTurn("s1", createAITurn(1));
      const fn = vi.fn();
      store.subscribe(fn);
      fn.mockClear();

      store.updateTurnReasoning("s1", 1, "a");
      store.updateTurnReasoning("s1", 1, "b");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("keeps reasoning text within the retention limit", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      store.addTurn("s1", createAITurn(1));

      store.updateTurnReasoning("s1", 1, "a".repeat(GAME_SESSION_RETENTION.maxReasoningChars + 20));

      const turn = store.getTurns("s1")[0];
      expect(turn.reasoning?.text).toHaveLength(GAME_SESSION_RETENTION.maxReasoningChars);
      expect(turn.reasoning?.text.endsWith("a".repeat(20))).toBe(true);
    });
  });

  describe("finalizeTurnReasoning", () => {
    it("replaces text and sets done=true", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      store.addTurn("s1", { ...createAITurn(1), reasoning: { text: "partial", done: false } });

      store.finalizeTurnReasoning("s1", 1, "final reasoning");
      const turn = store.getTurns("s1")[0];
      expect(turn.reasoning?.text).toBe("final reasoning");
      expect(turn.reasoning?.done).toBe(true);
    });
  });

  describe("completeAITurn", () => {
    it("updates action and stateAfter by turnNumber without touching reasoning", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      store.addTurn("s1", {
        ...createAITurn(1),
        action: PLACEHOLDER_AI_ACTION,
        stateAfter: { before: true },
        reasoning: { text: "streaming", done: false },
      });

      const action = { type: ActionType.MOVE, data: { index: 4 } };
      const stateAfter = { after: true };
      store.completeAITurn("s1", 1, action, stateAfter);

      const turn = store.getTurns("s1")[0];
      expect(turn.action).toEqual(action);
      expect(turn.stateAfter).toEqual(stateAfter);
      expect(turn.reasoning?.text).toBe("streaming");
      expect(turn.reasoning?.done).toBe(false);
    });

    it("does nothing if turn or session missing", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      expect(() => store.completeAITurn("s1", 99, { type: ActionType.MOVE, data: {} }, null)).not.toThrow();
      expect(() => store.completeAITurn("missing", 1, { type: ActionType.MOVE, data: {} }, null)).not.toThrow();
    });
  });

  describe("endSession", () => {
    it("sets status/endedAt and sends WS event game_session_end with the full session", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      store.addTurn("s1", createAITurn(1));

      store.endSession("s1", "won");
      const session = store.getSession("s1");
      expect(session?.status).toBe("won");
      expect(session?.endedAt).toBeDefined();
      expect(wsClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          event: GAME_SESSION_WS_EVENT.END,
          sessionId: "s1",
          gameId: "tictactoe",
          paradigm: GAME_PARADIGM.TURN_BASED,
          status: "won",
          startedAt: expect.any(Number),
          endedAt: expect.any(Number),
          turns: expect.any(Array),
          events: [],
        }),
      );
    });
  });

  describe("clearSession", () => {
    it("removes the session and emits", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      const fn = vi.fn();
      store.subscribe(fn);
      fn.mockClear();

      store.clearSession("s1");
      expect(store.getSession("s1")).toBeUndefined();
      expect(fn).toHaveBeenCalled();
    });
  });

  describe("getAITurns", () => {
    it("filters AI turns and returns [] for missing session", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      store.addTurn("s1", createAITurn(1));
      store.addTurn("s1", { ...createAITurn(2), actor: GAME_ACTOR.PLAYER });

      expect(store.getAITurns("s1")).toHaveLength(1);
      expect(store.getAITurns("s1")[0].turnNumber).toBe(1);
      expect(store.getAITurns("missing")).toEqual([]);
    });
  });

  describe("addEvent", () => {
    it("pushes an event and sends game_event", () => {
      store.startSession("s1", "snake", GAME_PARADIGM.REALTIME);
      const event: GameEventData = {
        eventId: "e1",
        type: "direction_change",
        timestamp: 1,
        stateAfter: { direction: "up" },
        payload: { direction: "up" },
      };
      store.addEvent("s1", event);
      expect(store.getSession("s1")?.events).toEqual([event]);
      expect(wsClient.send).toHaveBeenCalledWith({
        event: GAME_SESSION_WS_EVENT.EVENT,
        sessionId: "s1",
        eventData: event,
      });
    });
  });

  describe("retention limits", () => {
    it("keeps only the newest turns in memory", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      for (let i = 1; i <= GAME_SESSION_RETENTION.maxTurnsPerSession + 5; i += 1) {
        store.addTurn("s1", createAITurn(i));
      }

      const turns = store.getTurns("s1");
      expect(turns).toHaveLength(GAME_SESSION_RETENTION.maxTurnsPerSession);
      expect(turns[0].turnNumber).toBe(6);
    });

    it("keeps only the newest realtime events in memory", () => {
      store.startSession("s1", "snake", GAME_PARADIGM.REALTIME);
      for (let i = 1; i <= GAME_SESSION_RETENTION.maxEventsPerSession + 3; i += 1) {
        store.addEvent("s1", {
          eventId: `e${i}`,
          type: "direction_change",
          timestamp: i,
          stateAfter: { direction: "up" },
          payload: { direction: "up" },
        });
      }

      const events = store.getSession("s1")?.events ?? [];
      expect(events).toHaveLength(GAME_SESSION_RETENTION.maxEventsPerSession);
      expect(events[0].eventId).toBe("e4");
    });

    it("keeps only the newest log entries in memory", () => {
      store.startSession("s1", "tictactoe", GAME_PARADIGM.TURN_BASED);
      for (let i = 1; i <= GAME_SESSION_RETENTION.maxLogEntriesPerSession + 2; i += 1) {
        store.addLogEntry("s1", {
          id: `l${i}`,
          timestamp: i,
          kind: "ws_request",
          label: `Log ${i}`,
          icon: "send",
          details: {},
        });
      }

      const logs = store.getLogEntries("s1");
      expect(logs).toHaveLength(GAME_SESSION_RETENTION.maxLogEntriesPerSession);
      expect(logs[0].id).toBe("l3");
    });

    it("keeps only the newest sessions in memory", () => {
      for (let i = 1; i <= GAME_SESSION_RETENTION.maxSessions + 4; i += 1) {
        store.startSession(`s${i}`, "snake", GAME_PARADIGM.REALTIME);
      }

      expect(store.getSession("s1")).toBeUndefined();
      expect(store.getSession("s4")).toBeUndefined();
      expect(store.getSession("s5")).toBeDefined();
    });
  });
});

function createAITurn(turnNumber: number): GameTurnData {
  return {
    turnId: `ai-${turnNumber}`,
    turnNumber,
    slotId: "ai",
    actor: GAME_ACTOR.AI,
    action: PLACEHOLDER_AI_ACTION,
    stateAfter: null,
    timestamp: Date.now(),
    reasoning: { text: "", done: false },
  };
}
