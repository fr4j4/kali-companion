// useChat — hook that owns the chat state and the WS connection.
//
// Subscribes to kali-yarn events from the core, maintains the message
// list, and exposes helpers for sending input, starting new sessions,
// and toggling settings.

import { useCallback, useEffect, useRef, useState } from "react";
import { WSClient } from "../lib/wsClient";
import type {
  ArtifactEvent,
  ConnectedEvent,
  DeltaEvent,
  MessageEvent,
  ReadyEvent,
  ReasoningDeltaEvent,
  SessionListEvent,
  TtsAudioEvent,
  TtsFilteredEvent,
  StatusEvent,
  ErrorEvent,
  ConsentRequestEvent,
  ToolEvent,
  JobStartEvent,
  JobProgressEvent,
  JobDoneEvent,
  JobLogEvent,
  JobListEvent,
  ImageReadyEvent,
} from "../lib/protocol";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  reasoning?: string;
  toolEvent?: ToolEvent;
  inlineArtifacts?: ArtifactEvent[];
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
  send: (text: string) => void;
  stop: () => void;
  newSession: () => void;
  listSessions: () => void;
  attachSession: (sid: string) => void;
  updateSettings: (patch: Record<string, unknown>) => void;
  respondConsent: (id: string, decision: "allow" | "no_capture" | "cancel") => void;
  subscribeTts: (fn: (e: TtsAudioEvent) => void) => () => void;
  onTtsEnded: (fn: () => void) => () => void;
  listJobs: () => void;
  cancelJob: (id: string) => void;
  getJobLogs: (id: string) => void;
  requestImage: (key: string) => void;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m${Date.now()}_${idCounter}`;
}

// Tauri exposes registered commands on window.__TAURI__. Outside Tauri
// (plain browser dev) we fall back to the env-provided port.
export async function getSidecarPort(): Promise<number | undefined> {
  const tauri = (window as unknown as { __TAURI__?: { core?: { invoke: (c: string) => Promise<unknown> } } }).__TAURI__;
  if (tauri?.core?.invoke) {
    try {
      const port = await tauri.core.invoke("get_sidecar_port");
      return typeof port === "number" ? port : undefined;
    } catch {
      // not running under Tauri yet
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

  const clientRef = useRef<WSClient | null>(null);
  const ttsListeners = useRef<Array<(e: TtsAudioEvent) => void>>([]);
  const ttsEndedListeners = useRef<Array<() => void>>([]);

  useEffect(() => {
    let client: WSClient | null = null;
    let cancelled = false;

    async function connect() {
      const port = await getSidecarPort();
      if (!port || cancelled) {
        setStatus("error");
        return;
      }
      const isTauri = !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
      let wsUrl: string;
      if (isTauri) {
        // Tauri: connect directly to the core sidecar.
        wsUrl = `ws://127.0.0.1:${port}/ws`;
      } else {
        // Browser dev: connect via Vite proxy (same origin, no mixed content).
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        wsUrl = `${proto}//${host}/ws`;
      }
      client = new WSClient(wsUrl);
      clientRef.current = client;

      client.on("ready", (p) => {
        const ev = p as ReadyEvent;
        setError(null);
        setSessionId(ev.session_id);
        setStatus("ready");
        client?.send({ event: "list_sessions" });
      });
      client.on("connected", (p) => {
        const ev = p as ConnectedEvent;
        setError(null);
        setSessionId(ev.session_id);
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
        setStatus("error");
      });

      client.on("delta", (p) => {
        const ev = p as DeltaEvent;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              content: last.content + ev.text,
            };
            return updated;
          }
          return [
            ...prev,
            { id: nextId(), role: "assistant", content: ev.text, streaming: true },
          ];
        });
      });

      client.on("reasoning_delta", (p) => {
        const ev = p as ReasoningDeltaEvent;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              reasoning: (last.reasoning ?? "") + ev.text,
            };
            return updated;
          }
          return prev;
        });
      });

      client.on("turn_end", () => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            updated[updated.length - 1] = { ...last, streaming: false };
          }
          return updated;
        });
        // Signal TTS ended if no audio came for this turn.
        // The TTS hook will also detect when its queue empties.
        setTtsPlaying(false);
        ttsEndedListeners.current.forEach((fn) => fn());
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
        setSystemStatus(p as StatusEvent);
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

      client.on("artifact", (p) => {
        const ev = p as ArtifactEvent;
        setArtifacts((prev) => {
          const next = new Map(prev);
          if (ev.update === "close") {
            next.delete(ev.id);
          } else {
            next.set(ev.id, ev);
          }
          return next;
        });
        // Attach widget artifacts inline to the last assistant message.
        if (ev.type === "widget" && (ev.update === "create" || ev.update === "update")) {
          setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const msg = prev[i];
              if (msg.role === "assistant") {
                const existing = msg.inlineArtifacts ?? [];
                const found = existing.find((a) => a.id === ev.id);
                if (ev.update === "create" && found) break;
                const updated = [...prev];
                if (found) {
                  // Update existing inline artifact
                  updated[i] = {
                    ...msg,
                    inlineArtifacts: existing.map((a) =>
                      a.id === ev.id ? ev : a
                    ),
                  };
                } else {
                  // Add new inline artifact
                  updated[i] = { ...msg, inlineArtifacts: [...existing, ev] };
                }
                return updated;
              }
            }
            return prev;
          });
        }
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

      client.connect();
    }

    connect();
    return () => {
      cancelled = true;
      client?.disconnect();
    };
  }, []);

  const send = useCallback((text: string) => {
    if (!text.trim() || !clientRef.current) return;
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: text },
    ]);
    clientRef.current.send({ event: "input", content: text, source: "text" });
  }, []);

  const stop = useCallback(() => {
    clientRef.current?.send({ event: "stop" });
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        updated[updated.length - 1] = { ...last, streaming: false };
      }
      return updated;
    });
  }, []);

  const newSession = useCallback(() => {
    setMessages([]);
    setArtifacts(new Map());
    clientRef.current?.send({ event: "new_session" });
  }, []);

  const listSessions = useCallback(() => {
    clientRef.current?.send({ event: "list_sessions" });
  }, []);

  const attachSession = useCallback((sid: string) => {
    setMessages([]);
    setArtifacts(new Map());
    clientRef.current?.send({ event: "attach_session", session_id: sid });
  }, []);

  const updateSettings = useCallback((patch: Record<string, unknown>) => {
    clientRef.current?.send({ event: "settings", ...patch });
  }, []);

  const respondConsent = useCallback((id: string, decision: "allow" | "no_capture" | "cancel") => {
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

  return {
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
    send,
    stop,
    newSession,
    listSessions,
    attachSession,
    updateSettings,
    respondConsent,
    subscribeTts,
    onTtsEnded,
    listJobs,
    cancelJob,
    getJobLogs,
    requestImage,
  };
}