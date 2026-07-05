import { useCallback, useRef } from "react";
import type {
  ArtifactEvent,
  ConsentRequestEvent,
  DeltaEvent,
  ErrorEvent,
  JobDoneEvent,
  JobLogEvent,
  JobProgressEvent,
  JobStartEvent,
  ReasoningDeltaEvent,
  StatusEvent,
  TtsAudioEvent,
  TtsFilteredEvent,
  ToolEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "../lib/protocol";
import type { AvatarState, AvatarEmotion } from "../avatar/avatarConfig";
import { setDebugAvatarState, resetDebugAvatarState } from "../avatar/debugAvatarState";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  reasoning?: string;
  toolEvent?: ToolEvent;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `debug_${Date.now()}_${idCounter}`;
}

export interface DebugAPI {
  simulateUserMessage: (content: string) => void;
  simulateAssistantMessage: (content: string, streaming?: boolean) => void;
  simulateAssistantComplete: () => void;
  simulateThinkingStart: () => void;
  simulateReasoningDelta: (text: string) => void;
  simulateThinkingEnd: () => void;
  simulateToolRunning: (tool: string, params?: Record<string, unknown>) => void;
  simulateToolSuccess: (tool: string, output?: unknown) => void;
  simulateToolError: (tool: string, error?: string) => void;
  simulateStreamStart: () => void;
  simulateDelta: (text: string) => void;
  simulateStreamEnd: () => void;
  simulateJobStart: (id: string, type: string, params?: Record<string, unknown>) => void;
  simulateJobProgress: (id: string, progress: number) => void;
  simulateJobDone: (id: string, status: "done" | "error", result?: unknown, error?: string) => void;
  simulateJobLog: (id: string, line: string) => void;
  simulateArtifactCreate: (id: string, type: "html" | "markdown" | "diff" | "widget", title: string, content: string) => void;
  simulateArtifactUpdate: (id: string, content: string) => void;
  simulateArtifactClose: (id: string) => void;
  simulateTtsAudio: (segment: number, total: number, text: string) => void;
  simulateTtsFilterStats: (raw: number, filtered: number, filteredText: string) => void;
  simulateConsentRequest: (tool: string, risk?: string) => void;
  simulateError: (message: string) => void;
  simulateTurnStart: () => void;
  simulateTurnEnd: (cancelled?: boolean) => void;
  simulateStatus: (patch: Partial<StatusEvent>) => void;
  clearAll: () => void;
  speakText: (text: string) => void;
  setAvatarState: (state: AvatarState) => void;
  setAvatarEmotion: (emotion: AvatarEmotion, force?: boolean) => void;
  clearAvatarStateOverride: () => void;
  clearAvatarEmotionOverride: () => void;
  resetAvatarOverride: () => void;
}

export function useDebug(client: { simulate: (payload: unknown) => void; send: (payload: Record<string, unknown>) => void } | null): DebugAPI {
  const clientRef = useRef(client);
  clientRef.current = client;

  const speakText = useCallback((text: string) => {
    if (clientRef.current) {
      clientRef.current.send({ event: "tts_speak", text });
    }
  }, []);

  const simulateUserMessage = useCallback((content: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "message",
      id: nextId(),
      role: "user",
      text: content,
    } as unknown as ChatMessage);
  }, []);

  const simulateAssistantMessage = useCallback((content: string, streaming = false) => {
    if (!clientRef.current) return;
    if (streaming) {
      clientRef.current.simulate({
        event: "delta",
        session_id: "debug",
        text: content,
      } as unknown as DeltaEvent);
    } else {
      clientRef.current.simulate({
        event: "message",
        id: nextId(),
        role: "assistant",
        text: content,
      } as unknown as ChatMessage);
    }
  }, []);

  const simulateAssistantComplete = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "turn_end",
      session_id: "debug",
      cancelled: false,
    } as unknown as TurnEndEvent);
  }, []);

  const simulateThinkingStart = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "turn_start",
      session_id: "debug",
    } as unknown as TurnStartEvent);
  }, []);

  const simulateReasoningDelta = useCallback((text: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "reasoning_delta",
      session_id: "debug",
      text,
    } as unknown as ReasoningDeltaEvent);
  }, []);

  const simulateThinkingEnd = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "turn_end",
      session_id: "debug",
      cancelled: false,
    } as unknown as TurnEndEvent);
  }, []);

  const simulateToolRunning = useCallback((tool: string, params?: Record<string, unknown>) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "tool_event",
      session_id: "debug",
      tool,
      status: "running",
      params: params ?? {},
      output: null,
    } as unknown as ToolEvent);
  }, []);

  const simulateToolSuccess = useCallback((tool: string, output?: unknown) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "tool_event",
      session_id: "debug",
      tool,
      status: "success",
      params: {},
      output: output ?? null,
    } as unknown as ToolEvent);
  }, []);

  const simulateToolError = useCallback((tool: string, error?: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "tool_event",
      session_id: "debug",
      tool,
      status: "error",
      params: {},
      output: error ?? "Unknown error",
    } as unknown as ToolEvent);
  }, []);

  const simulateStreamStart = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "turn_start",
      session_id: "debug",
    } as unknown as TurnStartEvent);
    clientRef.current.simulate({
      event: "delta",
      session_id: "debug",
      text: "",
    } as unknown as DeltaEvent);
  }, []);

  const simulateDelta = useCallback((text: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "delta",
      session_id: "debug",
      text,
    } as unknown as DeltaEvent);
  }, []);

  const simulateStreamEnd = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "turn_end",
      session_id: "debug",
      cancelled: false,
    } as unknown as TurnEndEvent);
  }, []);

  const simulateJobStart = useCallback((id: string, type: string, params?: Record<string, unknown>) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "job_start",
      id,
      type,
      params: params ?? {},
      session_id: "debug",
    } as unknown as JobStartEvent);
  }, []);

  const simulateJobProgress = useCallback((id: string, progress: number) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "job_progress",
      id,
      progress,
    } as unknown as JobProgressEvent);
  }, []);

  const simulateJobDone = useCallback((id: string, status: "done" | "error", result?: unknown, error?: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "job_done",
      id,
      type: "debug",
      status,
      progress: 100,
      result,
      error,
    } as unknown as JobDoneEvent);
  }, []);

  const simulateJobLog = useCallback((id: string, line: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "job_log",
      id,
      line,
    } as unknown as JobLogEvent);
  }, []);

  const simulateArtifactCreate = useCallback((id: string, type: "html" | "markdown" | "diff" | "widget", title: string, content: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "artifact",
      id,
      type,
      windowType: type,
      title,
      content,
      update: "create",
    } as unknown as ArtifactEvent);
  }, []);

  const simulateArtifactUpdate = useCallback((id: string, content: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "artifact",
      id,
      type: "html",
      windowType: "html",
      title: "",
      content,
      update: "update",
    } as unknown as ArtifactEvent);
  }, []);

  const simulateArtifactClose = useCallback((id: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "artifact",
      id,
      type: "html",
      windowType: "html",
      title: "",
      content: "",
      update: "close",
    } as unknown as ArtifactEvent);
  }, []);

  const simulateTtsAudio = useCallback((segment: number, total: number, text: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "tts_audio",
      audio: "",
      segment,
      total_segments: total,
      text,
      duration: 0,
    } as unknown as TtsAudioEvent);
  }, []);

  const simulateTtsFilterStats = useCallback((raw: number, filtered: number, filteredText: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "tts_filtered",
      raw_length: raw,
      filtered_length: filtered,
      filtered_text: filteredText,
    } as unknown as TtsFilteredEvent);
  }, []);

  const simulateConsentRequest = useCallback((tool: string, risk = "low") => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "consent_request",
      id: nextId(),
      tool,
      risk,
      reason_key: "debug_consent",
      reason_params: {},
      summary_key: "debug_summary",
    } as unknown as ConsentRequestEvent);
  }, []);

  const simulateError = useCallback((message: string) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "error",
      detail: message,
    } as unknown as ErrorEvent);
  }, []);

  const simulateTurnStart = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "turn_start",
      session_id: "debug",
    } as unknown as TurnStartEvent);
  }, []);

  const simulateTurnEnd = useCallback((cancelled = false) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "turn_end",
      session_id: "debug",
      cancelled,
    } as unknown as TurnEndEvent);
  }, []);

  const simulateStatus = useCallback((patch: Partial<StatusEvent>) => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "status",
      llm_provider: patch.llm_provider ?? "debug",
      llm_model: patch.llm_model ?? "debug",
      tts_provider: patch.tts_provider ?? "debug",
      voice: patch.voice ?? "debug",
      tts_mode: patch.tts_mode ?? "debug",
      auto_tts: patch.auto_tts ?? true,
      capture_backend: patch.capture_backend ?? "debug",
      profile: patch.profile ?? "debug",
      ...patch,
    } as unknown as StatusEvent);
  }, []);

  const clearAll = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.simulate({
      event: "message",
      id: "clear_all_user",
      role: "user",
      text: "[debug] clearing all state",
    } as unknown as ChatMessage);
    clientRef.current.simulate({
      event: "turn_end",
      session_id: "debug",
      cancelled: false,
    } as unknown as TurnEndEvent);
    resetDebugAvatarState();
  }, []);

  const setAvatarState = useCallback((state: AvatarState) => {
    setDebugAvatarState({ overrideState: state });
  }, []);

  const setAvatarEmotion = useCallback((emotion: AvatarEmotion, force = false) => {
    setDebugAvatarState({ overrideEmotion: emotion, forceEmotion: force });
  }, []);

  const clearAvatarStateOverride = useCallback(() => {
    setDebugAvatarState({ overrideState: null });
  }, []);

  const clearAvatarEmotionOverride = useCallback(() => {
    setDebugAvatarState({ overrideEmotion: null, forceEmotion: false });
  }, []);

  const resetAvatarOverride = useCallback(() => {
    resetDebugAvatarState();
  }, []);

  return {
    simulateUserMessage,
    simulateAssistantMessage,
    simulateAssistantComplete,
    simulateThinkingStart,
    simulateReasoningDelta,
    simulateThinkingEnd,
    simulateToolRunning,
    simulateToolSuccess,
    simulateToolError,
    simulateStreamStart,
    simulateDelta,
    simulateStreamEnd,
    simulateJobStart,
    simulateJobProgress,
    simulateJobDone,
    simulateJobLog,
    simulateArtifactCreate,
    simulateArtifactUpdate,
    simulateArtifactClose,
    simulateTtsAudio,
    simulateTtsFilterStats,
    simulateConsentRequest,
    simulateError,
    simulateTurnStart,
    simulateTurnEnd,
    simulateStatus,
    clearAll,
    speakText,
    setAvatarState,
    setAvatarEmotion,
    clearAvatarStateOverride,
    clearAvatarEmotionOverride,
    resetAvatarOverride,
  };
}
