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
  llm_model?: string;
  llm_provider?: string;
  llm_api_url?: string;
  llm_api_key?: string;
  profile?: string;
  language?: string;
  stt_language?: string;
  wake_word_enabled?: boolean;
  input_mode?: string;
  feedback_mode?: string;
  plan_mode?: boolean;
}

export interface ConsentResponseEvent {
  event: "consent_response";
  id: string;
  decision: "allow" | "no_capture" | "cancel";
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
}

export interface AudioEndEvent {
  event: "audio_end";
}

export interface TtsSpeakEvent {
  event: "tts_speak";
  text: string;
}

// ── Outgoing (core → web) ────────────────────────────────

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
  content: string;
  update: "create" | "update" | "close";
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

export interface StatusEvent {
  event: "status";
  llm_provider: string;
  llm_api_url: string;
  llm_api_key_set: boolean;
  llm_model: string;
  tts_provider: string;
  voice: string;
  tts_mode: string;
  auto_tts: boolean;
  capture_backend: string;
  profile: string;
  available_profiles?: string[];
  stt_language?: string;
  wake_word_enabled?: boolean;
  input_mode?: string;
  feedback_mode?: string;
  plan_mode?: boolean;
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

export interface AttachSessionEvent {
  event: "attach_session";
  session_id: string;
}

export type IncomingEvent =
  | InputEvent
  | StopEvent
  | NewSessionEvent
  | ListSessionsEvent
  | AttachSessionEvent
  | SettingsEvent
  | ConsentResponseEvent
  | AudioStartEvent
  | AudioEndEvent
  | TtsSpeakEvent
  | ListJobsEvent
  | CancelJobEvent
  | GetJobLogsEvent
  | RequestImageEvent;

export type OutgoingEvent =
  | ReadyEvent
  | ConnectedEvent
  | DeltaEvent
  | ReasoningDeltaEvent
  | TurnEndEvent
  | MessageEvent
  | SttPartialEvent
  | SttFinalEvent
  | WakeWordEvent
  | TtsAudioEvent
  | TtsFilteredEvent
  | ArtifactEvent
  | TurnStartEvent
  | ToolEvent
  | ConsentRequestEvent
  | SessionListEvent
  | StatusEvent
  | ErrorEvent
  | DisconnectedEvent
  | JobStartEvent
  | JobProgressEvent
  | JobDoneEvent
  | JobLogEvent
  | JobListEvent
  | ImageReadyEvent;