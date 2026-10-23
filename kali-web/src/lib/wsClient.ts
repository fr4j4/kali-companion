// Typed WebSocket client implementing the kali-yarn protocol.
//
// Wraps a WebSocket connection, dispatches events by name to typed
// listeners, and provides helpers for sending events to the core.

import type { OutgoingEvent, EventName } from "./protocol";
import { getApiToken, getDesktopConfig } from "./desktop";

const DEFAULT_SEND_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

type Listener = (payload: OutgoingEvent) => void;
type IncomingEventName = EventName;

export class WSClient {
  private url: string;
  private sessionId?: string;
  private ws: WebSocket | null = null;
  private listeners = new Map<IncomingEventName, Set<Listener>>();
  private dynamicListeners: { prefix: string; fn: Listener }[] = [];
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pongDeadline: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, sessionId?: string) {
    this.url = url;
    this.sessionId = sessionId;
  }

  /** Detect half-open sockets (NAT/proxy idle cuts): ping, and force a reconnect if no pong arrives. */
  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      this.send({ event: "ping", t: Date.now() });
      this.pongDeadline = setTimeout(() => ws.close(), HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.pongDeadline) clearTimeout(this.pongDeadline);
    this.heartbeat = null;
    this.pongDeadline = null;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    const ws = this.ws;
    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.startHeartbeat(ws);
      // With core-side auth enabled, the first message MUST be the auth
      // challenge. Token empty = server skips validation (dev default).
      const token = getApiToken();
      this.send({ event: "auth", token });
      // When the native agent is running it registers the native actions itself.
      const desktop = getDesktopConfig();
      if (desktop?.capabilityToken && !desktop.nativeAgent && window.kaliDesktop && !window.location.hash.startsWith("#/desktop/artifact/")) {
        this.send({ event: "desktop_register", token: getDesktopConfig()!.capabilityToken });
      }
      const hello: Record<string, unknown> = { event: "hello", client: "kali-web", version: "0.1.0" };
      if (this.sessionId) {
        hello.session_id = this.sessionId;
      }
      this.send(hello);
    };

    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const payload = JSON.parse(ev.data) as OutgoingEvent;
        const event = (payload.event as IncomingEventName) ?? "";
        if ((event as string) === "pong") {
          if (this.pongDeadline) clearTimeout(this.pongDeadline);
          this.pongDeadline = null;
          return;
        }
        if (event === "auth_required") {
          // Server rejected our token (or none was sent) with auth enabled.
          // Surface the login gate; stop reconnecting until the user acts
          // (submit reloads the page with the new token in localStorage).
          this.shouldReconnect = false;
          window.dispatchEvent(new CustomEvent("kali:auth-required"));
          return;
        }
        if (event === "desktop_action" && window.kaliDesktop) {
          const action = payload as unknown as { id: string; action: string; params: Record<string, unknown> };
          void window.kaliDesktop.performAction(action.action, action.params || {})
            .then((result) => this.send({ event: "desktop_action_result", id: action.id, ok: true, result }))
            .catch((error: unknown) => this.send({ event: "desktop_action_result", id: action.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
          return;
        }
        this.dispatch(event, payload);
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onerror = () => this.dispatch("error", { event: "error", detail: "WS error" });
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.dispatch("disconnected", { event: "disconnected" });
      if (this.shouldReconnect) {
        // Jitter avoids every client reconnecting in lockstep after a server restart.
        setTimeout(() => this.connect(), this.reconnectDelay * (0.75 + Math.random() * 0.5));
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.ws?.close();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(event: IncomingEventName, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off(event: IncomingEventName, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Listen for events whose event name starts with a given prefix (e.g. "game_move_reasoning:"). */
  onDynamic(prefix: string, fn: Listener): () => void {
    const entry = { prefix, fn };
    this.dynamicListeners.push(entry);
    return () => {
      const idx = this.dynamicListeners.indexOf(entry);
      if (idx !== -1) this.dynamicListeners.splice(idx, 1);
    };
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendAndWait<T>(
    payload: Record<string, unknown>,
    responseEventName: string,
    timeoutMs: number = DEFAULT_SEND_TIMEOUT_MS,
    abortSignal?: AbortSignal,
    options?: {
      onProgress?: () => void;
      globalTimeoutMs?: number;
      matchFilter?: (response: T) => boolean;
    },
  ): Promise<T> & { __notifyProgress?: () => void } {
    if (abortSignal?.aborted) {
      return Object.assign(
        Promise.reject(new Error("sendAndWait aborted before send")),
        { __notifyProgress: () => {} },
      );
    }

    let notifyProgress: (() => void) | null = null;

    const promise = new Promise<T>((resolve, reject) => {
      let rejected = false;
      const startedAt = performance.now();
      const globalTimeoutMs = options?.globalTimeoutMs ?? timeoutMs;
      const progressName = `__progress:${responseEventName}` as IncomingEventName;
      let progressHandler: Listener | null = null;

      const cleanup = () => {
        clearTimeout(timer);
        this.off(responseEventName as IncomingEventName, handler as Listener);
        if (progressHandler) {
          this.off(progressName, progressHandler);
        }
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
      };

      const fail = (reason: string) => {
        if (rejected) return;
        rejected = true;
        cleanup();
        reject(new Error(reason));
      };

      let timer: ReturnType<typeof setTimeout>;
      let lastProgressAt = startedAt;

      const resetAttemptTimer = () => {
        if (rejected) return;
        clearTimeout(timer);
        lastProgressAt = performance.now();
        const elapsed = performance.now() - startedAt;
        const remainingGlobal = Math.max(0, globalTimeoutMs - elapsed);
        const nextTick = Math.min(timeoutMs, remainingGlobal);
        if (nextTick <= 0) {
          fail(`sendAndWait timed out after ${Math.round(elapsed)}ms (global)`);
          return;
        }
        timer = setTimeout(() => {
          const timeSinceProgress = performance.now() - lastProgressAt;
          const finalElapsed = performance.now() - startedAt;
          if (timeSinceProgress >= timeoutMs || finalElapsed >= globalTimeoutMs) {
            fail(`sendAndWait timed out after ${Math.round(finalElapsed)}ms (global)`);
          } else {
            fail(`sendAndWait timed out after ${timeoutMs}ms`);
          }
        }, nextTick);
      };
      resetAttemptTimer();

      const abortHandler = () => {
        fail("sendAndWait aborted");
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", abortHandler);
      }

      const matchFilter = options?.matchFilter;
      const handler = (response: OutgoingEvent) => {
        if (rejected) return;
        if (matchFilter && !matchFilter(response as T)) return;
        rejected = true;
        cleanup();
        console.log(`[WS ← ${responseEventName}]`, response);
        resolve(response as T);
      };

      progressHandler = () => {
        resetAttemptTimer();
      };

      this.on(responseEventName as IncomingEventName, handler as Listener);

      if (options?.onProgress) {
        this.on(progressName as IncomingEventName, progressHandler as Listener);
        const originalProgress = options.onProgress;
        notifyProgress = () => {
          this.dispatch(progressName as IncomingEventName, { event: progressName } as OutgoingEvent);
          originalProgress();
        };
      }

      console.log(`[WS → ${responseEventName}]`, payload);
      this.send(payload);
    });

    return Object.assign(promise, {
      __notifyProgress: notifyProgress ?? (() => {}),
    });
  }

  sendBinary(data: ArrayBuffer | Blob): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      console.warn(
        "[wsClient] binary dropped, WS not OPEN (state=%s)",
        this.ws?.readyState,
      );
    }
  }

  private dispatch(event: IncomingEventName, payload: OutgoingEvent): void {
    this.listeners.get(event)?.forEach((l) => l(payload));
    for (const { prefix, fn } of this.dynamicListeners) {
      if (event.startsWith(prefix)) {
        fn(payload);
      }
    }
  }

  simulate(payload: OutgoingEvent): void {
    const event = (payload.event as IncomingEventName) ?? "";
    this.dispatch(event, payload);
  }
}
