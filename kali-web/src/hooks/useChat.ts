// useChat — hook that owns the chat state and the WS connection.
//
// Subscribes to kali-yarn events from the core, maintains the message
// list, and exposes helpers for sending input, starting new sessions,
// and toggling settings.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WSClient } from "../lib/wsClient";
import type {
  ArtifactEvent,
  ConnectedEvent,
  ConsoleLogEntry,
  ConsoleRequestEvent,
  DeltaEvent,
  MessageEvent,
  ReadyEvent,
  ReasoningDeltaEvent,
  SessionListEvent,
  StepStartEvent,
  TtsAudioEvent,
  TtsFilteredEvent,
  StatusEvent,
  ErrorEvent,
  ConsentRequestEvent,
  ConsentDecision,
  ToolEvent,
  JobStartEvent,
  JobProgressEvent,
  JobDoneEvent,
  JobLogEvent,
  JobListEvent,
  ImageReadyEvent,
  SelectedArtifactRef,
  TurnStatsEvent,
  IncomingEvent,
  ConnectionsListEvent,
  DownloadTtsModelStartedEvent,
  DownloadTtsModelProgressEvent,
  DownloadTtsModelCompleteEvent,
  DownloadTtsModelErrorEvent,
  DownloadSttModelStartedEvent,
  DownloadSttModelProgressEvent,
  DownloadSttModelCompleteEvent,
  DownloadSttModelErrorEvent,
  TerminalSessionStartEvent,
  CommandStartEvent,
  CommandOutputEvent,
  CommandEndEvent,
  TerminalSessionEndEvent,
  TerminalSessionListEvent,
} from "../lib/protocol";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  reasoning?: string;
  toolEvent?: ToolEvent;
}

export interface SessionListItem {
  id: string;
  title: string;
  updated: string;
}

export interface JobItem {
  id: string;
  type: string;
  status: string;
  progress: number;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  logs?: string[];
}

export interface TerminalOutputLine {
  stream: "stdout" | "stderr";
  text: string;
  seq: number;
}

export interface TerminalCommandEntry {
  call_id: string;
  command: string;
  cwd: string;
  exit_code: number | null;
  status: "running" | "done" | "error" | "timeout" | "cancelled";
  started: string;
  finished: string | null;
  lines: TerminalOutputLine[];
  loaded: boolean;
}

export interface TerminalSessionData {
  id: string;
  display_name: string;
  status: "active" | "completed";
  created: string;
  commands: Map<string, TerminalCommandEntry>;
  commandOrder: string[];
  detailLoaded: boolean;
}

export type ConnStatus = "connecting" | "ready" | "error" | "disconnected";

export interface ChatState {
  status: ConnStatus;
  messages: ChatMessage[];
  sessionId: string | null;
  sessions: SessionListItem[];
  artifacts: Map<string, ArtifactEvent>;
  jobs: Map<string, JobItem>;
  imageReadyKeys: Set<string>;
  ttsPlaying: boolean;
  ttsSegment: number;
  ttsTotal: number;
  ttsFilteredRaw: number;
  ttsFilteredOut: number;
  error: string | null;
  systemStatus: StatusEvent | null;
  wsClient: WSClient | null;
  consentRequest: ConsentRequestEvent | null;
  toolEvents: ToolEvent[];
  isThinking: boolean;
  isTurnActive: boolean;
  currentStep: number;
  turnStats: TurnStatsEvent | null;
  /** True while the user explicitly requested a new session and we are waiting for the backend to assign an id. */
  isCreatingSession: boolean;
  terminalSessions: Map<string, TerminalSessionData>;
  getTerminalSessionDetail: (terminalSessionId: string) => void;
  send: (text: string) => void;
  sendEvent: (event: IncomingEvent) => void;
  setSelectedArtifactsProvider: (fn: (() => SelectedArtifactRef[]) | null) => void;
  stop: () => void;
  stopped: boolean;
  newSession: () => void;
  listSessions: () => void;
  attachSession: (sid: string) => void;
  deleteSession: (sid: string) => void;
  clearAllSessions: () => void;
  updateSettings: (patch: Record<string, unknown>) => void;
  respondConsent: (id: string, decision: ConsentDecision) => void;
  subscribeTts: (fn: (e: TtsAudioEvent) => void) => () => void;
  onTtsEnded: (fn: () => void) => () => void;
  listJobs: () => void;
  cancelJob: (id: string) => void;
  getJobLogs: (id: string) => void;
  requestImage: (key: string) => void;
  downloadTtsModel: (modelId: string, provider?: "qwen3" | "piper") => void;
  downloadSttModel: (modelId: string, provider?: "vosk" | "qwen3-asr") => void;
  downloadProgress: Record<string, number>;
  downloadError: string | null;
  /** Release the full content of an artifact from memory (close → metadata-only). */
  markArtifactClosed: (artifactId: string) => void;
  /** Store full content for an artifact (after a REST fetch on reopen). */
  setArtifactContent: (artifactId: string, event: ArtifactEvent) => void;
  /**
   * Register a getter for the current console logs of an open HTML artifact.
   * The getter is called when the agent requests logs via get_artifact_console.
   * Pass null to unregister.
   */
  registerConsoleProvider: (artifactId: string, getter: (() => ConsoleLogEntry[]) | null) => void;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m${Date.now()}_${idCounter}`;
}

// The Electron shell exposes a `window.kali.getSidecarPort()` API via
// contextBridge (see kali-shell/src/preload.ts). Outside Electron (plain
// browser dev) we fall back to the env-provided port.
export async function getSidecarPort(): Promise<number | undefined> {
  const kali = (window as unknown as { kali?: { getSidecarPort: () => Promise<unknown> } }).kali;
  if (kali?.getSidecarPort) {
    try {
      const port = await kali.getSidecarPort();
      return typeof port === "number" ? port : undefined;
    } catch {
      // not running under Electron yet
    }
  }
  return Number(import.meta.env.VITE_KALI_PORT ?? 8900);
}

export function useChat(): ChatState {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [artifacts, setArtifacts] = useState<Map<string, ArtifactEvent>>(new Map());
  const [jobs, setJobs] = useState<Map<string, JobItem>>(new Map());
  const [imageReadyKeys, setImageReadyKeys] = useState<Set<string>>(new Set());
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsSegment, setTtsSegment] = useState(0);
  const [ttsTotal, setTtsTotal] = useState(0);
  const [ttsFilteredRaw, setTtsFilteredRaw] = useState(0);
  const [ttsFilteredOut, setTtsFilteredOut] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<StatusEvent | null>(null);
  const [consentRequest, setConsentRequest] = useState<ConsentRequestEvent | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isTurnActive, setIsTurnActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [turnStats, setTurnStats] = useState<TurnStatsEvent | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const [terminalSessions, setTerminalSessions] = useState<Map<string, TerminalSessionData>>(new Map());

  const cmdOutputBufferRef = useRef<Map<string, TerminalOutputLine[]>>(new Map());
  const cmdOutputRafRef = useRef<number | null>(null);

  const clientRef = useRef<WSClient | null>(null);
  const ttsListeners = useRef<Array<(e: TtsAudioEvent) => void>>([]);
  const ttsEndedListeners = useRef<Array<() => void>>([]);
  const selectedArtifactsProviderRef = useRef<(() => SelectedArtifactRef[]) | null>(null);
  // Registry of open HTML widgets keyed by artifact id, so the agent can
  // request console logs on demand. Each entry is a getter that returns
  // the current ConsoleLogEntry[] from the widget's React state.
  const consoleProvidersRef = useRef<Map<string, () => ConsoleLogEntry[]>>(new Map());

  // ── Streaming delta batcher ───────────────────────────────
  // Deltas arrive token-by-token (potentially hundreds per second).
  // Instead of setMessages per delta, we accumulate text + reasoning
  // into mutable refs and flush once per animation frame. This reduces
  // React re-renders from ~500/stream to ~60/s (one per rAF).
  const deltaBufferRef = useRef<{ content: string; reasoning: string; hasContent: boolean; hasReasoning: boolean }>({
    content: "",
    reasoning: "",
    hasContent: false,
    hasReasoning: false,
  });
  const deltaRafRef = useRef<number | null>(null);

  const flushDeltas = useCallback(() => {
    deltaRafRef.current = null;
    const buf = deltaBufferRef.current;
    if (!buf.hasContent && !buf.hasReasoning) return;
    const contentDelta = buf.content;
    const reasoningDelta = buf.reasoning;
    const hasContent = buf.hasContent;
    const hasReasoning = buf.hasReasoning;
    buf.content = "";
    buf.reasoning = "";
    buf.hasContent = false;
    buf.hasReasoning = false;

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          ...(hasContent ? { content: last.content + contentDelta } : {}),
          ...(hasReasoning ? { reasoning: (last.reasoning ?? "") + reasoningDelta } : {}),
        };
        return updated;
      }
      return [
        ...prev,
        {
          id: nextId(),
          role: "assistant" as const,
          content: hasContent ? contentDelta : "",
          streaming: true,
          ...(hasReasoning ? { reasoning: reasoningDelta } : {}),
        },
      ];
    });
  }, []);

  const scheduleDeltaFlush = useCallback(() => {
    if (deltaRafRef.current !== null) return;
    deltaRafRef.current = requestAnimationFrame(flushDeltas);
  }, [flushDeltas]);

  const flushCommandOutput = useCallback(() => {
    cmdOutputRafRef.current = null;
    const buffer = cmdOutputBufferRef.current;
    if (buffer.size === 0) return;
    const entries = Array.from(buffer.entries());
    buffer.clear();

    setTerminalSessions((prev) => {
      const next = new Map(prev);
      for (const [callId, newLines] of entries) {
        for (const [, sess] of next) {
          const cmd = sess.commands.get(callId);
          if (cmd) {
            sess.commands.set(callId, {
              ...cmd,
              lines: [...cmd.lines, ...newLines],
            });
            break;
          }
        }
      }
      return next;
    });
  }, []);

  const scheduleCommandOutputFlush = useCallback(() => {
    if (cmdOutputRafRef.current !== null) return;
    cmdOutputRafRef.current = requestAnimationFrame(flushCommandOutput);
  }, [flushCommandOutput]);

  useEffect(() => {
    let client: WSClient | null = null;
    let cancelled = false;

    async function connect() {
      const port = await getSidecarPort();
      if (!port || cancelled) {
        setStatus("error");
        return;
      }
      const isElectron = !!(window as unknown as { kali?: unknown }).kali;
      let wsUrl: string;
      if (isElectron) {
        // Electron: connect directly to the core sidecar.
        wsUrl = `ws://127.0.0.1:${port}/ws`;
      } else {
        // Browser dev: connect via Vite proxy (same origin, no mixed content).
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        wsUrl = `${proto}//${host}/ws`;
      }
      const savedSessionId = localStorage.getItem("kali.sessionId") || undefined;
      client = new WSClient(wsUrl, savedSessionId);
      clientRef.current = client;

      client.on("ready", (p) => {
        const ev = p as ReadyEvent;
        setError(null);
        setSessionId(ev.session_id || null);
        if (ev.session_id) {
          localStorage.setItem("kali.sessionId", ev.session_id);
        } else {
          localStorage.removeItem("kali.sessionId");
        }
        setStatus("ready");
        setIsCreatingSession(false);
        client?.send({ event: "list_sessions" });
      });
      client.on("connected", (p) => {
        const ev = p as ConnectedEvent;
        setError(null);
        setSessionId(ev.session_id || null);
        setIsCreatingSession(false);
        if (ev.session_id) {
          localStorage.setItem("kali.sessionId", ev.session_id);
        } else {
          localStorage.removeItem("kali.sessionId");
        }
        // Refresh the sessions list so a newly created or attached session
        // appears immediately in the sidebar.
        client?.send({ event: "list_sessions" });
      });
      client.on("session_list", (p) => {
        const ev = p as SessionListEvent;
        setSessions(ev.sessions);
      });
      client.on("message", (p) => {
        const ev = p as MessageEvent;
        setMessages((prev) => [...prev, {
          id: nextId(),
          role: ev.role as "user" | "assistant",
          content: ev.text,
        }]);
      });
      client.on("disconnected", () => setStatus("disconnected"));
      client.on("error", (p) => {
        const ev = p as ErrorEvent;
        setError(ev.detail ?? "connection error");
        // Only mark connection as broken for transport-level errors,
        // not operational errors like "Cannot change STT provider...".
        const isTransportError = ev.detail?.includes("connection")
          || ev.detail?.includes("WebSocket")
          || ev.detail?.includes("handshake")
          || !ev.detail;
        if (isTransportError) {
          setStatus("error");
        }
      });

      client.on("turn_start", () => {
        setIsThinking(true);
        setIsTurnActive(true);
        setCurrentStep(0);
        setStopped(false);
        setTurnStats(null);
      });

      client.on("step_start", (p) => {
        const ev = p as unknown as StepStartEvent;
        setCurrentStep(ev.step);
        setIsThinking(true);
      });

      client.on("delta", (p) => {
        setIsThinking(false);
        const ev = p as DeltaEvent;
        deltaBufferRef.current.content += ev.text;
        deltaBufferRef.current.hasContent = true;
        scheduleDeltaFlush();
      });

      client.on("reasoning_delta", (p) => {
        setIsThinking(false);
        const ev = p as ReasoningDeltaEvent;
        deltaBufferRef.current.reasoning += ev.text;
        deltaBufferRef.current.hasReasoning = true;
        scheduleDeltaFlush();
      });

      client.on("turn_end", () => {
        // Flush any pending buffered deltas before marking the message
        // as non-streaming, so no tokens are lost.
        if (deltaRafRef.current !== null) {
          cancelAnimationFrame(deltaRafRef.current);
          deltaRafRef.current = null;
        }
        flushDeltas();
        setIsThinking(false);
        setIsTurnActive(false);
        setCurrentStep(0);
        setStopped(false);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            updated[updated.length - 1] = { ...last, streaming: false };
          }
          return updated;
        });
        setTtsPlaying(false);
        ttsEndedListeners.current.forEach((fn) => fn());
      });

      client.on("turn_stats", (p) => {
        setTurnStats(p as TurnStatsEvent);
      });

      client.on("tts_audio", (p) => {
        const ev = p as TtsAudioEvent;
        setTtsSegment(ev.segment);
        setTtsTotal(ev.total_segments);
        setTtsPlaying(true);
        ttsListeners.current.forEach((fn) => fn(ev));
      });

      client.on("tts_filtered", (p) => {
        const ev = p as TtsFilteredEvent;
        setTtsFilteredRaw(ev.raw_length);
        setTtsFilteredOut(ev.filtered_length);
      });

      client.on("status", (p) => {
        setSystemStatus(prev => ({ ...prev, ...(p as StatusEvent) }));
      });

      client.on("connections_list", (p) => {
        const ev = p as ConnectionsListEvent;
        setSystemStatus(prev => prev ? { ...prev, connections: ev.connections } : prev);
      });

      client.on("consent_request", (p) => {
        setConsentRequest(p as ConsentRequestEvent);
      });

      client.on("tool_event", (p) => {
        const ev = p as ToolEvent;
        setToolEvents((prev) => [...prev, ev]);
        setMessages((prev) => {
          const existing = prev.find(
            (m) => m.toolEvent && m.toolEvent.session_id === ev.session_id && m.toolEvent.tool === ev.tool
          );
          if (existing) {
            return prev.map((m) =>
              m === existing ? { ...m, toolEvent: ev } : m
            );
          }
          return [...prev, {
            id: nextId(),
            role: "assistant",
            content: "",
            toolEvent: ev,
          }];
        });
      });

      // wake_word events are handled by usePTT (PCM-level detection via AudioWorklet).
      // useChat ignores them — no need to subscribe here.
      client.on("wake_word", () => {});

      // ── Terminal session events ──────────────────────────

      client.on("terminal_session_start", (p) => {
        const ev = p as TerminalSessionStartEvent;
        setTerminalSessions((prev) => {
          const next = new Map(prev);
          const existing = next.get(ev.terminal_session_id);
          if (existing && ev.commands) {
            const cmdMap = new Map<string, TerminalCommandEntry>();
            const order: string[] = [];
            for (const c of ev.commands) {
              cmdMap.set(c.call_id, {
                call_id: c.call_id,
                command: c.command,
                cwd: c.cwd,
                exit_code: c.exit_code,
                status: c.status,
                started: c.started,
                finished: c.finished,
                lines: c.output_lines.map(([stream, text, seq]) => ({ stream: stream as "stdout" | "stderr", text, seq })),
                loaded: true,
              });
              order.push(c.call_id);
            }
            next.set(ev.terminal_session_id, {
              ...existing,
              commands: cmdMap,
              commandOrder: order,
              detailLoaded: true,
            });
          } else if (!existing) {
            next.set(ev.terminal_session_id, {
              id: ev.terminal_session_id,
              display_name: ev.display_name,
              status: ev.status as "active" | "completed",
              created: new Date().toISOString(),
              commands: new Map(),
              commandOrder: [],
              detailLoaded: !!ev.commands,
            });
          }
          return next;
        });
      });

      client.on("command_start", (p) => {
        const ev = p as CommandStartEvent;
        setTerminalSessions((prev) => {
          const next = new Map(prev);
          let sess = next.get(ev.terminal_session_id);
          if (!sess) {
            sess = {
              id: ev.terminal_session_id,
              display_name: "Session",
              status: "active",
              created: new Date().toISOString(),
              commands: new Map(),
              commandOrder: [],
              detailLoaded: false,
            };
            next.set(ev.terminal_session_id, sess);
          }
          if (!sess.commands.has(ev.call_id)) {
            sess.commands.set(ev.call_id, {
              call_id: ev.call_id,
              command: ev.command,
              cwd: ev.cwd,
              exit_code: null,
              status: "running",
              started: new Date().toISOString(),
              finished: null,
              lines: [],
              loaded: false,
            });
            sess.commandOrder.push(ev.call_id);
          }
          return next;
        });
      });

      client.on("command_output", (p) => {
        const ev = p as CommandOutputEvent;
        const line: TerminalOutputLine = { stream: ev.stream, text: ev.line, seq: Date.now() };
        const buffer = cmdOutputBufferRef.current;
        const existing = buffer.get(ev.call_id);
        if (existing) {
          existing.push(line);
        } else {
          buffer.set(ev.call_id, [line]);
        }
        scheduleCommandOutputFlush();
      });

      client.on("command_end", (p) => {
        const ev = p as CommandEndEvent;
        if (cmdOutputRafRef.current !== null) {
          cancelAnimationFrame(cmdOutputRafRef.current);
          cmdOutputRafRef.current = null;
        }
        flushCommandOutput();
        setTerminalSessions((prev) => {
          const next = new Map(prev);
          for (const [, sess] of next) {
            const cmd = sess.commands.get(ev.call_id);
            if (cmd) {
              sess.commands.set(ev.call_id, {
                ...cmd,
                exit_code: ev.exit_code,
                status: ev.status,
                finished: new Date().toISOString(),
              });
              break;
            }
          }
          return next;
        });
      });

      client.on("terminal_session_end", (p) => {
        const ev = p as TerminalSessionEndEvent;
        setTerminalSessions((prev) => {
          const next = new Map(prev);
          const sess = next.get(ev.terminal_session_id);
          if (sess) {
            next.set(ev.terminal_session_id, { ...sess, status: "completed" });
          }
          return next;
        });
      });

      client.on("terminal_session_list", (p) => {
        const ev = p as TerminalSessionListEvent;
        setTerminalSessions(() => {
          const next = new Map<string, TerminalSessionData>();
          for (const s of ev.sessions) {
            next.set(s.id, {
              id: s.id,
              display_name: s.display_name,
              status: s.status as "active" | "completed",
              created: s.created,
              commands: new Map(),
              commandOrder: [],
              detailLoaded: false,
            });
          }
          return next;
        });
      });

      client.on("artifact", (p) => {
        const ev = p as ArtifactEvent;
        setArtifacts((prev) => {
          const next = new Map(prev);
          if (ev.update === "close" && ev.phase !== "complete") {
            // True close (not a streaming-complete): remove from store.
            next.delete(ev.id);
          } else if (ev.content == null && ev.preview !== undefined) {
            // Metadata-only replay (session reattach): the backend sent an
            // index entry with no content. Keep the existing entry if we
            // already have one with content (e.g. live update arrived first),
            // otherwise store this lightweight entry as-is. The workspace
            // sync effect decides whether to fetch content for open windows.
            const existing = next.get(ev.id);
            if (!existing || existing.content == null) {
              next.set(ev.id, ev);
            } else {
              // Preserve any metadata refresh (title/type) on an existing entry.
              next.set(ev.id, { ...existing, ...ev, content: existing.content });
            }
          } else {
            // create/update, or close+complete: upsert with the event
            // (phase lets widgets know if content is still streaming).
            next.set(ev.id, ev);
          }
          return next;
        });
      });

      // ── Job events ──────────────────────────────────────

      client.on("job_start", (p) => {
        const ev = p as JobStartEvent;
        setJobs((prev) => {
          const next = new Map(prev);
          next.set(ev.id, {
            id: ev.id,
            type: ev.type,
            status: "running",
            progress: 0,
            params: ev.params,
            created_at: new Date().toISOString(),
            logs: [],
          });
          return next;
        });
      });

      client.on("job_progress", (p) => {
        const ev = p as JobProgressEvent;
        setJobs((prev) => {
          const next = new Map(prev);
          const job = next.get(ev.id);
          if (job) {
            next.set(ev.id, { ...job, progress: ev.progress });
          }
          return next;
        });
      });

      client.on("job_done", (p) => {
        const ev = p as JobDoneEvent;
        setJobs((prev) => {
          const next = new Map(prev);
          const job = next.get(ev.id);
          if (job) {
            next.set(ev.id, {
              ...job,
              status: ev.status,
              progress: ev.progress,
              result: ev.result,
              error: ev.error,
              finished_at: new Date().toISOString(),
            });
          }
          return next;
        });
      });

      client.on("job_log", (p) => {
        const ev = p as JobLogEvent;
        setJobs((prev) => {
          const next = new Map(prev);
          const job = next.get(ev.id);
          if (job) {
            next.set(ev.id, { ...job, logs: [...(job.logs ?? []), ev.line] });
          }
          return next;
        });
      });

      client.on("job_list", (p) => {
        const ev = p as JobListEvent;
        if (ev.jobs) {
          setJobs(() => {
            const next = new Map<string, JobItem>();
            for (const j of ev.jobs ?? []) {
              let params: Record<string, unknown> = {};
              try { params = JSON.parse(j.params); } catch { /* keep default */ }
              let result: unknown = undefined;
              try { if (j.result) result = JSON.parse(j.result); } catch { /* keep default */ }
              next.set(j.id, {
                id: j.id,
                type: j.type,
                status: j.status,
                progress: j.progress,
                params,
                result,
                error: j.error,
                created_at: j.created_at,
                started_at: j.started_at,
                finished_at: j.finished_at,
                logs: [],
              });
            }
            return next;
          });
        }
        if (ev.logs && ev.job_id) {
          setJobs((prev) => {
            const next = new Map(prev);
            const job = next.get(ev.job_id!);
            if (job) {
              next.set(ev.job_id!, { ...job, logs: ev.logs!.map((l) => l.line) });
            }
            return next;
          });
        }
      });

      // ── Image ready events ───────────────────────────────

      client.on("image_ready", (p) => {
        const ev = p as ImageReadyEvent;
        if (ev.path) {
          setImageReadyKeys((prev) => new Set(prev).add(ev.key));
        }
      });

      // ── Console log request (agent → frontend) ──────────

      client.on("console_request", (p) => {
        const ev = p as ConsoleRequestEvent;
        const getter = consoleProvidersRef.current.get(ev.artifact_id);
        if (getter) {
          const allLogs = getter();
          const logs = allLogs.slice(-ev.limit);
          client?.send({ event: "console_response", id: ev.id, logs });
        } else {
          // No widget open for this artifact id.
          client?.send({ event: "console_response", id: ev.id, logs: null });
        }
      });

      // ── TTS model download events ────────────────────────

      client.on("download_tts_model_started", (p) => {
        const ev = p as DownloadTtsModelStartedEvent;
        setDownloadError(null);
        setDownloadProgress((prev) => ({ ...prev, [ev.model_id]: 0 }));
      });

      client.on("download_tts_model_progress", (p) => {
        const ev = p as DownloadTtsModelProgressEvent;
        setDownloadProgress((prev) => ({ ...prev, [ev.model_id]: ev.progress }));
      });

      client.on("download_tts_model_complete", (p) => {
        const ev = p as DownloadTtsModelCompleteEvent;
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[ev.model_id];
          return next;
        });
      });

      client.on("download_tts_model_error", (p) => {
        const ev = p as DownloadTtsModelErrorEvent;
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[ev.model_id];
          return next;
        });
        setDownloadError(ev.detail);
      });

      // ── STT model download events ────────────────────────

      client.on("download_stt_model_started", (p) => {
        const ev = p as DownloadSttModelStartedEvent;
        setDownloadError(null);
        setDownloadProgress((prev) => ({ ...prev, [ev.model_id]: 0 }));
      });

      client.on("download_stt_model_progress", (p) => {
        const ev = p as DownloadSttModelProgressEvent;
        setDownloadProgress((prev) => ({ ...prev, [ev.model_id]: ev.progress }));
      });

      client.on("download_stt_model_complete", (p) => {
        const ev = p as DownloadSttModelCompleteEvent;
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[ev.model_id];
          return next;
        });
      });

      client.on("download_stt_model_error", (p) => {
        const ev = p as DownloadSttModelErrorEvent;
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[ev.model_id];
          return next;
        });
        setDownloadError(ev.detail);
      });

      client.connect();
    }

    connect();
    return () => {
      cancelled = true;
      client?.disconnect();
      if (deltaRafRef.current !== null) {
        cancelAnimationFrame(deltaRafRef.current);
        deltaRafRef.current = null;
      }
      if (cmdOutputRafRef.current !== null) {
        cancelAnimationFrame(cmdOutputRafRef.current);
        cmdOutputRafRef.current = null;
      }
    };
  }, []);

  const send = useCallback((text: string) => {
    if (!text.trim() || !clientRef.current) return;
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: text },
    ]);
    const provider = selectedArtifactsProviderRef.current;
    const selected = provider ? provider() : [];
    clientRef.current.send({
      event: "input",
      content: text,
      source: "text",
      ...(selected.length > 0 ? { selected_artifacts: selected } : {}),
    });
  }, []);

  const setSelectedArtifactsProvider = useCallback(
    (fn: (() => SelectedArtifactRef[]) | null) => {
      selectedArtifactsProviderRef.current = fn;
    },
    [],
  );

  const stop = useCallback(() => {
    clientRef.current?.send({ event: "stop" });
    // Flush pending deltas before marking as non-streaming.
    if (deltaRafRef.current !== null) {
      cancelAnimationFrame(deltaRafRef.current);
      deltaRafRef.current = null;
    }
    flushDeltas();
    setStopped(true);
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        updated[updated.length - 1] = { ...last, streaming: false };
      }
      return updated;
    });
  }, [flushDeltas]);

  const newSession = useCallback(() => {
    setMessages([]);
    setArtifacts(new Map());
    setToolEvents([]);
    setTerminalSessions(new Map());
    setConsentRequest(null);
    setTtsPlaying(false);
    setTtsSegment(0);
    setTtsTotal(0);
    setTurnStats(null);
    // Clear any in-progress turn state so "Thinking" pills and step counters
    // from the previous session do not linger in the new one.
    setIsThinking(false);
    setIsTurnActive(false);
    setCurrentStep(0);
    setStopped(false);
    // Drop transient session-scoped collections so the new session starts clean.
    setJobs(new Map());
    setImageReadyKeys(new Set());
    // Clear the active session synchronously so the UI stops bookmarking the
    // previous session URL and the workspace reset effect can fire as soon as
    // the backend assigns a new id.
    setSessionId(null);
    localStorage.removeItem("kali.sessionId");
    consoleProvidersRef.current.clear();
    // Mark that we are explicitly creating a new session. StageProvider uses
    // this to navigate to the URL root and to suppress re-attachment to the old
    // session URL while we wait for the backend to assign a new id.
    setIsCreatingSession(true);
    clientRef.current?.send({ event: "new_session" });
  }, []);

  const listSessions = useCallback(() => {
    clientRef.current?.send({ event: "list_sessions" });
  }, []);

  const attachSession = useCallback((sid: string) => {
    setMessages([]);
    setArtifacts(new Map());
    setToolEvents([]);
    setTerminalSessions(new Map());
    setConsentRequest(null);
    setTtsPlaying(false);
    setTtsSegment(0);
    setTtsTotal(0);
    clientRef.current?.send({ event: "attach_session", session_id: sid });
  }, []);

  const deleteSession = useCallback((sid: string) => {
    clientRef.current?.send({ event: "delete_session", session_id: sid });
  }, []);

  const clearAllSessions = useCallback(() => {
    clientRef.current?.send({ event: "clear_all_sessions" });
  }, []);

  const sendEvent = useCallback((event: IncomingEvent) => {
    clientRef.current?.send(event as unknown as Record<string, unknown>);
  }, []);

  const updateSettings = useCallback((patch: Record<string, unknown>) => {
    clientRef.current?.send({ event: "settings", ...patch });
  }, []);

  const respondConsent = useCallback((id: string, decision: ConsentDecision) => {
    clientRef.current?.send({ event: "consent_response", id, decision });
    setConsentRequest(null);
  }, []);

  const listJobs = useCallback(() => {
    clientRef.current?.send({ event: "list_jobs" });
  }, []);

  const cancelJob = useCallback((id: string) => {
    clientRef.current?.send({ event: "cancel_job", id });
  }, []);

  const getJobLogs = useCallback((id: string) => {
    clientRef.current?.send({ event: "get_job_logs", id });
  }, []);

  const requestImage = useCallback((key: string) => {
    clientRef.current?.send({ event: "request_image", key });
  }, []);

  const downloadTtsModel = useCallback((modelId: string, provider?: "qwen3" | "piper") => {
    setDownloadError(null);
    clientRef.current?.send({ event: "download_tts_model", model_id: modelId, provider: provider ?? "qwen3" });
  }, []);

  const downloadSttModel = useCallback((modelId: string, provider?: "vosk" | "qwen3-asr") => {
    setDownloadError(null);
    clientRef.current?.send({ event: "download_stt_model", model_id: modelId, provider });
  }, []);

  const getTerminalSessionDetail = useCallback((terminalSessionId: string) => {
    clientRef.current?.send({ event: "get_terminal_session", terminal_session_id: terminalSessionId });
  }, []);

  /** Release the full content of an artifact, keeping only metadata + preview. */
  const markArtifactClosed = useCallback((artifactId: string) => {
    setArtifacts((prev) => {
      const entry = prev.get(artifactId);
      if (!entry || entry.content == null) return prev;
      const next = new Map(prev);
      next.set(artifactId, { ...entry, content: null });
      return next;
    });
  }, []);

  /** Store full content for an artifact (e.g. after a REST fetch on reopen). */
  const setArtifactContent = useCallback((artifactId: string, event: ArtifactEvent) => {
    setArtifacts((prev) => {
      const next = new Map(prev);
      next.set(artifactId, event);
      return next;
    });
  }, []);

  /** Register/unregister a getter for the current console logs of an open HTML widget. */
  const registerConsoleProvider = useCallback((artifactId: string, getter: (() => ConsoleLogEntry[]) | null) => {
    if (getter) {
      consoleProvidersRef.current.set(artifactId, getter);
    } else {
      consoleProvidersRef.current.delete(artifactId);
    }
  }, []);

  // Allow the TTS hook to subscribe to audio events.
  const subscribeTts = useCallback((fn: (e: TtsAudioEvent) => void) => {
    ttsListeners.current.push(fn);
    return () => {
      ttsListeners.current = ttsListeners.current.filter((l) => l !== fn);
    };
  }, []);

  const onTtsEnded = useCallback((fn: () => void) => {
    ttsEndedListeners.current.push(fn);
    return () => {
      ttsEndedListeners.current = ttsEndedListeners.current.filter((l) => l !== fn);
    };
  }, []);

  return useMemo(() => ({
    status,
    messages,
    sessionId,
    sessions,
    artifacts,
    jobs,
    imageReadyKeys,
    ttsPlaying,
    ttsSegment,
    ttsTotal,
    ttsFilteredRaw,
    ttsFilteredOut,
    error,
    systemStatus,
    wsClient: clientRef.current,
    consentRequest,
    toolEvents,
    isThinking,
    isTurnActive,
    currentStep,
    turnStats,
    stopped,
    send,
    sendEvent,
    setSelectedArtifactsProvider,
    stop,
    newSession,
    listSessions,
    attachSession,
    deleteSession,
    clearAllSessions,
    updateSettings,
    respondConsent,
    subscribeTts,
    onTtsEnded,
    listJobs,
    cancelJob,
    getJobLogs,
    requestImage,
    downloadTtsModel,
    downloadSttModel,
    downloadProgress,
    downloadError,
    markArtifactClosed,
    setArtifactContent,
    registerConsoleProvider,
    terminalSessions,
    getTerminalSessionDetail,
    isCreatingSession,
  }), [
    status, messages, sessionId, sessions, artifacts, jobs, imageReadyKeys,
    ttsPlaying, ttsSegment, ttsTotal, ttsFilteredRaw, ttsFilteredOut,
    error, systemStatus, consentRequest, toolEvents, isThinking, isTurnActive,
    currentStep, turnStats, stopped, downloadProgress, downloadError,
    isCreatingSession,
    terminalSessions, getTerminalSessionDetail,
    send, sendEvent, setSelectedArtifactsProvider, stop, newSession,
    listSessions, attachSession, deleteSession, clearAllSessions, updateSettings,
    respondConsent, subscribeTts, onTtsEnded, listJobs, cancelJob, getJobLogs,
    requestImage, downloadTtsModel, downloadSttModel,
    markArtifactClosed, setArtifactContent, registerConsoleProvider,
  ]);
}