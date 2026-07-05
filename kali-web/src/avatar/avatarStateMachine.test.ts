import { describe, expect, it, vi } from "vitest";
import { deriveState, deriveEmotion, type AvatarContext } from "./avatarStateMachine";
import type { EmotionProvider, EmotionResult } from "./EmotionProvider";
import type { ToolEvent } from "../lib/protocol";

const NOW = 1_000_000_000;

function makeCtx(overrides: Partial<AvatarContext> = {}): AvatarContext {
  return {
    emotionEvents: [],
    toolEvents: [],
    chatError: null,
    now: NOW,
    debug: { overrideState: null, overrideEmotion: null, forceEmotion: false },
    consentRequest: null,
    ttsPlaying: false,
    pttState: "idle",
    streaming: false,
    typing: false,
    overrideEmotion: null,
    currentMood: "normal",
    emotionProvider: mockProvider({ emotion: null, confidence: 0 }),
    ...overrides,
  } as AvatarContext;
}

function mockProvider(result: EmotionResult): EmotionProvider {
  return {
    getEmotion: vi.fn().mockResolvedValue(result),
  };
}

function runningTool(tool = "test_tool"): ToolEvent {
  return {
    event: "tool_event",
    session_id: "s1",
    tool,
    status: "running",
    params: {},
    output: null,
  };
}

function errorTool(tool = "test_tool"): ToolEvent {
  return {
    event: "tool_event",
    session_id: "s1",
    tool,
    status: "error",
    params: {},
    output: null,
  };
}

describe("avatarStateMachine", () => {
  describe("deriveState", () => {
    it("returns debug overrideState when set", () => {
      const ctx = makeCtx({ debug: { overrideState: "hablando", overrideEmotion: null, forceEmotion: false } });
      expect(deriveState(ctx)).toBe("hablando");
    });

    it("returns idle when consentRequest is present", () => {
      const ctx = makeCtx({ consentRequest: {} });
      expect(deriveState(ctx)).toBe("idle");
    });

    it("returns idle when tool is running", () => {
      const ctx = makeCtx({ toolEvents: [runningTool()] });
      expect(deriveState(ctx)).toBe("idle");
    });

    it("returns hablando when ttsPlaying", () => {
      const ctx = makeCtx({ ttsPlaying: true });
      expect(deriveState(ctx)).toBe("hablando");
    });

    it("returns escuchando when ptt recording", () => {
      const ctx = makeCtx({ pttState: "recording" });
      expect(deriveState(ctx)).toBe("escuchando");
    });

    it("returns escuchando when ptt listening", () => {
      const ctx = makeCtx({ pttState: "listening" });
      expect(deriveState(ctx)).toBe("escuchando");
    });

    it("returns pensando when streaming", () => {
      const ctx = makeCtx({ streaming: true });
      expect(deriveState(ctx)).toBe("pensando");
    });

    it("returns idle by default", () => {
      const ctx = makeCtx();
      expect(deriveState(ctx)).toBe("idle");
    });
  });

  describe("deriveEmotion", () => {
    it("returns overrideEmotion when active", async () => {
      const ctx = makeCtx({
        overrideEmotion: { emotion: "ronroneando", until: NOW + 10_000 },
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("ronroneando");
    });

    it("returns debug overrideEmotion when forceEmotion is true", async () => {
      const ctx = makeCtx({
        debug: { overrideState: null, overrideEmotion: "feliz", forceEmotion: true },
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("feliz");
    });

    it("returns concentrado when tool is running (regression: NOT enojado)", async () => {
      const ctx = makeCtx({
        toolEvents: [runningTool()],
        emotionProvider: mockProvider({ emotion: null, confidence: 0 }),
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("concentrado");
    });

    it("returns esperando when consentRequest is present", async () => {
      const ctx = makeCtx({
        consentRequest: {},
        emotionProvider: mockProvider({ emotion: null, confidence: 0 }),
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("esperando");
    });

    it("returns confundido when tool error and no LLM emotion", async () => {
      const ctx = makeCtx({
        toolEvents: [errorTool()],
        emotionProvider: mockProvider({ emotion: null, confidence: 0 }),
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("confundido");
    });

    it("returns LLM emotion when tool error and LLM provides one", async () => {
      const ctx = makeCtx({
        toolEvents: [errorTool()],
        emotionProvider: mockProvider({ emotion: "feliz", confidence: 0.9 }),
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("feliz");
    });

    it("returns LLM emotion when LLM provides one", async () => {
      const ctx = makeCtx({
        emotionProvider: mockProvider({ emotion: "enojado", confidence: 0.9 }),
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("enojado");
    });

    it("returns currentMood when no LLM emotion and no programmatic trigger", async () => {
      const ctx = makeCtx({
        emotionProvider: mockProvider({ emotion: null, confidence: 0 }),
        currentMood: "feliz",
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("feliz");
    });

    it("returns LLM emotion during ttsPlaying (not neutralized)", async () => {
      const ctx = makeCtx({
        ttsPlaying: true,
        emotionProvider: mockProvider({ emotion: "enojado", confidence: 0.9 }),
      });
      expect(await deriveEmotion(ctx, "hablando")).toBe("enojado");
    });
  });

  describe("precedence", () => {
    it("override > debug > tool > LLM", async () => {
      const overrideProvider = mockProvider({ emotion: "feliz", confidence: 0.9 });
      const ctx = makeCtx({
        overrideEmotion: { emotion: "ronroneando", until: NOW + 10_000 },
        debug: { overrideState: null, overrideEmotion: "enojado", forceEmotion: true },
        toolEvents: [runningTool()],
        emotionProvider: overrideProvider,
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("ronroneando");
    });

    it("debug > tool > LLM", async () => {
      const ctx = makeCtx({
        debug: { overrideState: null, overrideEmotion: "feliz", forceEmotion: true },
        toolEvents: [runningTool()],
        emotionProvider: mockProvider({ emotion: "enojado", confidence: 0.9 }),
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("feliz");
    });

    it("tool > LLM emotion", async () => {
      const ctx = makeCtx({
        toolEvents: [runningTool()],
        emotionProvider: mockProvider({ emotion: "feliz", confidence: 0.9 }),
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("concentrado");
    });
  });

  describe("persistent mood", () => {
    it("returns currentMood when no emotion event and no tool running", async () => {
      const ctx = makeCtx({
        emotionProvider: mockProvider({ emotion: null, confidence: 0 }),
        currentMood: "confundido",
      });
      expect(await deriveEmotion(ctx, "idle")).toBe("confundido");
    });
  });
});
