// kali-yarn protocol types — TypeScript mirror of the WS event catalogue.
//
// See docs/PROTOCOL.md for the full spec. Kept in sync with
// kali_core/yarn/protocol.py.

export type EventName = string;

export interface SelectedArtifactRef {
  id: string;
  type: string;
  title: string;
}

export interface InputEvent {
  event: "input";
  session_id?: string;
  content: string;
  source: "text" | "voice";
  selected_artifacts?: SelectedArtifactRef[];
}

export interface StopEvent {
  event: "stop";
  session_id?: string;
}

export interface NewSessionEvent {
  event: "new_session";
}

export interface ListSessionsEvent {
  event: "list_sessions";
}

export interface SettingsEvent {
  event: "settings";
  voice?: string;
  tts_mode?: string;
  auto_tts?: boolean;
  tts_provider?: TtsProvider;
  tts_model?: string;
  tts_device?: string;
  tts_models_dir?: string;
  llm_model?: string;
  llm_provider?: string;
  llm_api_url?: string;
  llm_api_key?: string;
  llm_max_tokens?: number;
  profile?: string;
  language?: string;
  ui_language?: string;
  stt_enabled?: boolean;
  stt_language?: string;
  stt_provider?: string;
  stt_model?: string;
  stt_device?: string;
  stt_streaming?: boolean;
  stt_models_dir?: string;
  stt_vad_enabled?: boolean;
  stt_vad_mode?: number;
  stt_vad_silence_timeout?: number;
  stt_vad_auto_calibrate?: boolean;
  stt_vad_rms_threshold?: number;
  game_session_path?: string;
  wake_word_enabled?: boolean;
  input_mode?: string;
  feedback_mode?: string;
  plan_mode?: boolean;
  artifact_diff_preview?: boolean;
  // Qwen3 VoiceDesign fields
  voice_instructions?: string;
  voice_seed?: number;
  game_ai_global_timeout_ms?: number;
  game_connection_id?: string;
  game_model?: string;
  game_temperature?: number;
  game_max_tokens?: number;
  game_retry_timeout_1_ms?: number;
  game_retry_timeout_2_ms?: number;
  game_retry_timeout_3_ms?: number;
  game_max_retries?: number;
}

export interface ConsentResponseEvent {
  event: "consent_response";
  id: string;
  decision: "allow" | "no_capture" | "cancel";
}

/** A single console log entry from an HTML artifact's iframe. */
export interface ConsoleLogEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  message: string;
  timestamp: number;
}

/** Backend → frontend: the agent requests console logs for an artifact. */
export interface ConsoleRequestEvent {
  event: "console_request";
  id: string;
  artifact_id: string;
  limit: number;
}

/** Frontend → backend: the frontend responds with the artifact's console logs. */
export interface ConsoleResponseEvent {
  event: "console_response";
  id: string;
  logs: ConsoleLogEntry[] | null;
}

export interface ListJobsEvent {
  event: "list_jobs";
}

export interface CancelJobEvent {
  event: "cancel_job";
  id: string;
}

export interface GetJobLogsEvent {
  event: "get_job_logs";
  id: string;
}

export interface RequestImageEvent {
  event: "request_image";
  key: string;
}

export interface AudioStartEvent {
  event: "audio_start";
  language?: string;
  origin?: "manual" | "wake_word" | "continuous";
}

export interface AudioEndEvent {
  event: "audio_end";
}

export interface TtsSpeakEvent {
  event: "tts_speak";
  text: string;
}

// Qwen3-TTS voice design preset (returned by /voices when tts_variant is voicedesign)
export interface VoiceDesignPreset {
  id: string;
  name: string;
  instructions: string;
  seed: number;
}

// Custom voice created by the user (stored in SQLite)
export interface CustomVoice {
  id: string;
  name: string;
  provider: string;
  instructions: string;
  seed: number;
  created_at: string;
  updated_at: string;
}

// Qwen3-TTS predefined voice (returned by /voices when provider is qwen3)
export interface QwenVoice {
  id: string;
  name: string;
  gender: string;
}

export interface TtsModelVoice {
  id: string;
  name: string;
  gender?: string | null;
  source: "config" | "speaker" | "preset";
}

export interface TtsModelInfo {
  id: string;
  display_name: string;
  estimated_vram_mb: number;
  available: boolean;
  loaded: boolean;
  device: string | null;
  supported_languages: string[];
  voices: TtsModelVoice[];
  variant: string | null;
}

export interface TtsDeviceInfo {
  id: string;
  name: string;
  vram_total_mb?: number;
  vram_free_mb?: number;
  ram_total_mb?: number;
  ram_free_mb?: number;
}

export type TtsProvider = "piper" | "qwen3" | "http" | "unavailable";
export type SttProvider = "vosk" | "qwen3";

export interface ReadyEvent {
  event: "ready";
  session_id: string;
  version: string;
}

export interface ConnectedEvent {
  event: "connected";
  session_id: string;
}

export interface DeltaEvent {
  event: "delta";
  session_id: string;
  text: string;
}

export interface ReasoningDeltaEvent {
  event: "reasoning_delta";
  session_id: string;
  text: string;
}

export interface TurnEndEvent {
  event: "turn_end";
  session_id: string;
  cancelled?: boolean;
}

export interface MessageEvent {
  event: "message";
  session_id: string;
  role: string;
  text: string;
}

export interface SttPartialEvent {
  event: "stt_partial";
  text: string;
}

export interface SttFinalEvent {
  event: "stt_final";
  text: string;
  provider?: string;
}

export interface VadStateEvent {
  event: "vad_state";
  is_speech: boolean;
}

export interface WakeWordEvent {
  event: "wake_word";
  text: string;
  confidence: number;
}

export interface TtsAudioEvent {
  event: "tts_audio";
  audio: string; // base64 WAV
  segment: number;
  total_segments: number;
  text: string;
  duration: number;
}

export interface TtsFilteredEvent {
  event: "tts_filtered";
  raw_length: number;
  filtered_length: number;
  filtered_text: string;
}

export interface ArtifactEvent {
  event: "artifact";
  id: string;
  type: "html" | "markdown" | "diff" | "widget";
  windowType: string;
  title: string;
  /**
   * Full payload during live streaming / updates.
   * `null` on metadata-only replays (session reattach): the frontend keeps
   * only the `preview` in memory and fetches the full content on demand via
   * `fetchArtifact` when the user reopens a closed artifact.
   */
  content: string | null;
  update: "create" | "update" | "close";
  phase?: "streaming" | "complete";
  language?: string;
  /** Short text preview (HTML stripped). Present on metadata-only replays. */
  preview?: string;
}

export interface TurnStartEvent {
  event: "turn_start";
  session_id: string;
}

export interface StepStartEvent {
  event: "step_start";
  session_id: string;
  step: number;
}

export interface ToolEvent {
  event: "tool_event";
  session_id: string;
  tool: string;
  status: "running" | "success" | "error" | "cancelled";
  params: Record<string, unknown>;
  output: unknown;
}

export interface ConsentRequestEvent {
  event: "consent_request";
  id: string;
  tool: string;
  risk: string;
  reason_key: string;
  reason_params: Record<string, string>;
  summary_key: string;
}

export interface SessionListEvent {
  event: "session_list";
  sessions: Array<{ id: string; title: string; updated: string }>;
}

// ── AI provider connections (saved LLM endpoints) ────────────

export type ConnectionKind = "local" | "cloud";
export type ApiFormat = "openai" | "ollama" | "llamacpp" | "lmstudio" | "vllm" | "custom";

export interface ConnectionSummary {
  id: string;
  name: string;
  kind: ConnectionKind;
  api_url: string;
  api_format: ApiFormat;
  vendor_detected: string;
  model_count: number;
  is_active: boolean;
  active_model: string | null;
}

export interface CloudProviderInfo {
  id: string;
  name: string;
  api_url: string;
  docs_url: string;
  notes: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  vendor: string;
  models: string[];
  detail: string;
}

export interface CreateConnectionRequest {
  event: "create_connection";
  name: string;
  kind: ConnectionKind;
  api_url: string;
  api_format: ApiFormat;
  api_key?: string;
  vendor_detected?: string;
  models?: string[];
}

export interface UpdateConnectionRequest {
  event: "update_connection";
  id: string;
  patch: {
    name?: string;
    api_url?: string;
    api_format?: ApiFormat;
    api_key?: string;
    vendor_detected?: string;
    models?: string[];
  };
}

export interface DeleteConnectionRequest {
  event: "delete_connection";
  id: string;
}

export interface ActivateConnectionRequest {
  event: "activate_connection";
  id: string;
  model: string;
}

export interface DeactivateConnectionRequest {
  event: "deactivate_connection";
}

// Backend → frontend: full connections snapshot
export interface ConnectionsListEvent {
  event: "connections_list";
  connections: ConnectionSummary[];
  active_id: string | null;
}

export interface StatusEvent {
  event: "status";
  llm_provider: string;
  llm_api_url: string;
  llm_api_key_set: boolean;
  llm_model: string;
  llm_max_tokens?: number;
  llm_connection_id?: string | null;
  llm_connection_name?: string | null;
  connections?: ConnectionSummary[];
  tts_provider: TtsProvider;
  voice: string;
  tts_mode: string;
  auto_tts: boolean;
  tts_loaded?: boolean;
  tts_model?: string;
  tts_device?: string;
  tts_available?: boolean;
  tts_error?: string | null;
  tts_variant?: string | null;
  capture_backend: string;
  profile: string;
  available_profiles?: string[];
  stt_provider: SttProvider;
  stt_model?: string;
  stt_device?: string;
  stt_loaded?: boolean;
  stt_enabled?: boolean;
  stt_streaming?: boolean;
  stt_models_dir?: string;
  tts_models_dir?: string;
  stt_vad_enabled?: boolean;
  stt_vad_mode?: number;
  stt_vad_silence_timeout?: number;
  stt_vad_auto_calibrate?: boolean;
  stt_vad_rms_threshold?: number;
  stt_language?: string;
  wake_word_enabled?: boolean;
  input_mode?: string;
  feedback_mode?: string;
  plan_mode?: boolean;
  artifact_diff_preview?: boolean;
  game_session_path?: string;
  game_ai_global_timeout_ms?: number;
  game_connection_id?: string;
  game_model?: string;
  game_temperature?: number;
  game_max_tokens?: number;
  game_retry_timeout_1_ms?: number;
  game_retry_timeout_2_ms?: number;
  game_retry_timeout_3_ms?: number;
  game_max_retries?: number;
  config_warnings?: string[];
}

export interface ErrorEvent {
  event: "error";
  detail: string;
}

export interface DisconnectedEvent {
  event: "disconnected";
}

// ── Job events (outgoing) ─────────────────────────────────

export interface JobStartEvent {
  event: "job_start";
  id: string;
  type: string;
  params: Record<string, unknown>;
  session_id?: string;
}

export interface JobProgressEvent {
  event: "job_progress";
  id: string;
  progress: number;
}

export interface JobDoneEvent {
  event: "job_done";
  id: string;
  type: string;
  status: "done" | "error" | "cancelled";
  progress: number;
  result?: unknown;
  error?: string;
}

export interface JobLogEvent {
  event: "job_log";
  id: string;
  line: string;
}

export interface JobListEvent {
  event: "job_list";
  jobs?: Array<{
    id: string;
    type: string;
    status: string;
    progress: number;
    params: string;
    result?: string;
    error?: string;
    created_at: string;
    started_at?: string;
    finished_at?: string;
  }>;
  logs?: Array<{ id: number; job_id: string; line: string; created_at: string }>;
  job_id?: string;
}

export interface ImageReadyEvent {
  event: "image_ready";
  key: string;
  path: string;
  error?: string;
}

export interface TurnStatsEvent {
  event: "turn_stats";
  session_id: string;
  elapsed: number;
  first_token_latency: number | null;
  char_count: number;
  tool_call_count: number;
  usage?: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    reasoning_tokens: number | null;
  };
}

export interface AttachSessionEvent {
  event: "attach_session";
  session_id: string;
}

export interface DeleteSessionEvent {
  event: "delete_session";
  session_id: string;
}

export interface ClearAllSessionsEvent {
  event: "clear_all_sessions";
}

export interface DownloadTtsModelEvent {
  event: "download_tts_model";
  model_id: string;
  provider?: "qwen3" | "piper";
}

export interface DownloadTtsModelStartedEvent {
  event: "download_tts_model_started";
  model_id: string;
}

export interface DownloadTtsModelProgressEvent {
  event: "download_tts_model_progress";
  model_id: string;
  kind: "tokenizer" | "model";
  progress: number;
  downloaded: number;
  total: number;
}

export interface DownloadTtsModelCompleteEvent {
  event: "download_tts_model_complete";
  model_id: string;
}

export interface DownloadTtsModelErrorEvent {
  event: "download_tts_model_error";
  model_id: string;
  detail: string;
}

export interface DownloadSttModelEvent {
  event: "download_stt_model";
  model_id: string;
  provider?: "vosk" | "qwen3-asr";
}

export interface DownloadSttModelStartedEvent {
  event: "download_stt_model_started";
  model_id: string;
}

export interface DownloadSttModelProgressEvent {
  event: "download_stt_model_progress";
  model_id: string;
  kind: string;
  progress: number;
  downloaded: number;
  total: number;
}

export interface DownloadSttModelCompleteEvent {
  event: "download_stt_model_complete";
  model_id: string;
}

export interface DownloadSttModelErrorEvent {
  event: "download_stt_model_error";
  model_id: string;
  detail: string;
}

export interface ModelCatalogEntry {
  id: string;
  provider: string;
  display_name: string;
  language: string;
  language_code: string;
  size_mb: number;
  quality: string;
  downloaded: boolean;
}

// ── Game AI WebSocket Events ────────────────────────────────────────────────

export interface GameRules {
  system_prompt: string;
  response_format?: string;
  [key: string]: unknown;
}

export interface GameMoveEvent {
  event: "game_move";
  game_type: string;
  session_id?: string;
  game_session_id?: string;
  rules: GameRules;
  game_state: Record<string, unknown>;
  player_role: string;
  difficulty?: string;
  starter?: string;
  player_marker?: string;
  opponent_marker?: string;
}

export interface GameAction {
  type: string;
  data: Record<string, unknown>;
}

export type GameMoveErrorCode = "PARSE_ERROR" | "INVALID_MOVE" | "MODEL_ERROR" | "NO_LEGAL_MOVES";

export interface GameMoveError {
  code: GameMoveErrorCode;
  message: string;
  fallback_action?: GameAction;
}

export interface GameMoveReasoningEvent {
  event: string; // "game_move_reasoning:<game_session_id>"
  chunk?: string;
  done?: boolean;
}

export interface GameMoveResponseEvent {
  event: "game_move_response";
  game_type: string;
  session_id?: string;
  action: GameAction | null;
  error: GameMoveError | null;
  reasoning?: string;
}

// ── Game session events ──────────────────────────────

import type {
  GameSessionData,
  GameTurnData,
  GameEventData,
  GameSessionMeta,
} from "../games/core/game-session-types";

export interface GameSessionStartEvent {
  event: "game_session_start";
  sessionId: string;
  gameId: string;
  paradigm: "turn-based" | "realtime";
}

export interface GameTurnEvent {
  event: "game_turn";
  sessionId: string;
  turnData: GameTurnData;
}

export interface GameSessionEndEvent {
  event: "game_session_end";
  sessionId: string;
  gameId: string;
  paradigm: string;
  status: string;
  startedAt: number;
  endedAt: number;
  turns: GameTurnData[];
  events: GameEventData[];
}

export interface GameSessionListEvent {
  event: "list_game_sessions";
  gameId?: string;
}

export interface GameSessionListResponseEvent {
  event: "list_game_sessions";
  sessions: GameSessionMeta[];
}

export interface GameSessionLoadEvent {
  event: "load_game_session";
  sessionId: string;
}

export interface GameSessionLoadedResponseEvent {
  event: "game_session_loaded";
  session: GameSessionData | null;
}

export interface GameSessionDeleteEvent {
  event: "delete_game_session";
  sessionId: string;
}

export interface GameSessionDeletedResponseEvent {
  event: "game_session_deleted";
  sessionId: string;
  deleted: boolean;
}

export interface GameSessionPersistedEvent {
  event: "game_session_persisted";
  sessionId: string;
  path: string;
}

export type IncomingEvent =
  | InputEvent
  | StopEvent
  | NewSessionEvent
  | ListSessionsEvent
  | AttachSessionEvent
  | DeleteSessionEvent
  | ClearAllSessionsEvent
  | SettingsEvent
  | ConsentResponseEvent
  | ConsoleResponseEvent
  | AudioStartEvent
  | AudioEndEvent
  | TtsSpeakEvent
  | ListJobsEvent
  | CancelJobEvent
  | GetJobLogsEvent
  | RequestImageEvent
  | CreateConnectionRequest
  | UpdateConnectionRequest
  | DeleteConnectionRequest
  | ActivateConnectionRequest
  | DeactivateConnectionRequest
  | DownloadTtsModelEvent
  | DownloadSttModelEvent
  | GameMoveEvent
  | GameSessionStartEvent
  | GameTurnEvent
  | GameSessionEndEvent
  | GameSessionListEvent
  | GameSessionLoadEvent
  | GameSessionDeleteEvent;

export type OutgoingEvent =
  | ReadyEvent
  | ConnectedEvent
  | DeltaEvent
  | ReasoningDeltaEvent
  | TurnEndEvent
  | MessageEvent
  | SttPartialEvent
  | SttFinalEvent
  | VadStateEvent
  | WakeWordEvent
  | TtsAudioEvent
  | TtsFilteredEvent
  | ArtifactEvent
  | TurnStartEvent
  | ToolEvent
  | ConsentRequestEvent
  | ConsoleRequestEvent
  | SessionListEvent
  | StatusEvent
  | ConnectionsListEvent
  | ErrorEvent
  | DisconnectedEvent
  | JobStartEvent
  | JobProgressEvent
  | JobDoneEvent
  | JobLogEvent
  | JobListEvent
  | ImageReadyEvent
  | TurnStatsEvent
  | DownloadTtsModelStartedEvent
  | DownloadTtsModelProgressEvent
  | DownloadTtsModelCompleteEvent
  | DownloadTtsModelErrorEvent
  | DownloadSttModelStartedEvent
  | DownloadSttModelProgressEvent
  | DownloadSttModelCompleteEvent
  | DownloadSttModelErrorEvent
  | GameMoveResponseEvent
  | GameMoveReasoningEvent;