import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AISlot } from "../ai-slot";
import { KaliErrorCode } from "../../core/constants/game-ai";
import { ActionType } from "../../core/constants/action-types";
import type { WSClient } from "../../../lib/wsClient";

describe("AISlot reasoning timeout behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockWSClient(opts: {
    responseDelayMs: number;
    reasoningChunks: { delay: number; text: string }[];
    response?: { action?: { type: string; data: unknown }; reasoning?: string };
  }): WSClient {
    const client = {
      onDynamic: vi.fn((prefix, fn) => {
        for (const chunk of opts.reasoningChunks) {
          setTimeout(() => {
            fn({ event: prefix, chunk: chunk.text });
          }, chunk.delay);
        }
        return () => {};
      }),
      sendAndWait: vi.fn(async (payload, _event, timeoutMs, _signal, options) => {
        return new Promise((resolve, reject) => {
          const startedAt = performance.now();
          const globalTimeoutMs = options?.globalTimeoutMs ?? timeoutMs;
          const matchFilter = options?.matchFilter as
            | ((response: { game_session_id?: string | null }) => boolean)
            | undefined;
          const requestGameSessionId = (payload as { game_session_id?: string }).game_session_id;

          let rejected = false;
          const fail = (reason: string) => {
            if (rejected) return;
            rejected = true;
            reject(new Error(reason));
          };

          let timer = setTimeout(() => {
            fail(`sendAndWait timed out after ${timeoutMs}ms`);
          }, Math.min(timeoutMs, globalTimeoutMs));

          const resetTimer = () => {
            if (rejected) return;
            clearTimeout(timer);
            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(0, globalTimeoutMs - elapsed);
            if (remaining <= 0) {
              fail(`sendAndWait timed out after ${Math.round(elapsed)}ms (global)`);
              return;
            }
            timer = setTimeout(() => {
              fail(`sendAndWait timed out after ${timeoutMs}ms`);
            }, Math.min(timeoutMs, remaining));
          };

          const check = () => {
            const elapsed = performance.now() - startedAt;
            if (elapsed >= opts.responseDelayMs) {
              const response = {
                event: "game_move_response" as const,
                game_session_id: requestGameSessionId ?? null,
                action: opts.response?.action ?? { type: ActionType.MOVE, data: { row: 0, col: 0 } },
                reasoning: opts.response?.reasoning ?? "",
              };
              if (matchFilter && !matchFilter(response)) {
                return;
              }
              clearTimeout(timer);
              resolve(response);
            } else {
              if (options?.onProgress) {
                options.onProgress();
                resetTimer();
              }
              setTimeout(check, 50);
            }
          };
          setTimeout(check, 50);
        });
      }),
    } as unknown as WSClient;
    return client;
  }

  it("resolves when reasoning chunks keep arriving and response fits within global timeout", async () => {
    const wsClient = createMockWSClient({
      responseDelayMs: 15_000,
      reasoningChunks: [
        { delay: 8_000, text: "hmm" },
        { delay: 12_000, text: " maybe" },
        { delay: 14_000, text: " center" },
      ],
    });

    const slot = new AISlot("opponent", wsClient, () => "sid-1");
    slot.setGlobalTimeout(() => 20_000);

    const state = {
      status: "playing" as const,
      data: {
        board: [
          [null, null, null],
          [null, null, null],
          [null, null, null],
        ],
        difficulty: "medium",
        starter: "player",
        playerMark: "X",
        opponentMark: "O",
      },
      score: 0,
      winner: null,
    };

    const decidePromise = slot.decide(state, 1);

    await vi.runAllTimersAsync();

    await expect(decidePromise).resolves.toEqual(
      expect.objectContaining({
        type: ActionType.MOVE,
      }),
    );
  });

  it("fails with WS_TIMEOUT when response exceeds global timeout", async () => {
    const wsClient = createMockWSClient({
      responseDelayMs: 25_000,
      reasoningChunks: [{ delay: 5_000, text: "still thinking..." }],
    });

    const slot = new AISlot("opponent", wsClient, () => "sid-1");
    slot.setGlobalTimeout(() => 20_000);

    const state = {
      status: "playing" as const,
      data: {
        board: [
          [null, null, null],
          [null, null, null],
          [null, null, null],
        ],
        difficulty: "medium",
        starter: "player",
        playerMark: "X",
        opponentMark: "O",
      },
      score: 0,
      winner: null,
    };

    const decidePromise = slot.decide(state, 1);
    const rejection = expect(decidePromise).rejects.toMatchObject({
      code: KaliErrorCode.WS_TIMEOUT,
    });

    await vi.runAllTimersAsync();

    await rejection;
  });

  it("uses the default global timeout when no setter is provided", async () => {
    const wsClient = createMockWSClient({
      responseDelayMs: 5_000,
      reasoningChunks: [{ delay: 1_000, text: "quick" }],
    });

    const slot = new AISlot("opponent", wsClient, () => "sid-1");
    // no setGlobalTimeout

    const state = {
      status: "playing" as const,
      data: {
        board: [
          [null, null, null],
          [null, null, null],
          [null, null, null],
        ],
        difficulty: "medium",
        starter: "player",
        playerMark: "X",
        opponentMark: "O",
      },
      score: 0,
      winner: null,
    };

    const decidePromise = slot.decide(state, 1);

    await vi.runAllTimersAsync();

    await expect(decidePromise).resolves.toEqual(
      expect.objectContaining({
        type: ActionType.MOVE,
      }),
    );
  });
});
