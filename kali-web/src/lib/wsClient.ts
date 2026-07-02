// Typed WebSocket client implementing the kali-yarn protocol.
//
// Wraps a WebSocket connection, dispatches events by name to typed
// listeners, and provides helpers for sending events to the core.

import type { OutgoingEvent, EventName } from "./protocol";

const DEFAULT_SEND_TIMEOUT_MS = 10_000;

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

  constructor(url: string, sessionId?: string) {
    this.url = url;
    this.sessionId = sessionId;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
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
        this.dispatch(event, payload);
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onerror = () => this.dispatch("error", { event: "error", detail: "WS error" });
    this.ws.onclose = () => {
      this.dispatch("disconnected", { event: "disconnected" });
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
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
  ): Promise<T> {
    if (abortSignal?.aborted) {
      return Promise.reject(new Error("sendAndWait aborted before send"));
    }

    return new Promise((resolve, reject) => {
      let rejected = false;

      const timer = setTimeout(() => {
        rejected = true;
        this.off(responseEventName as IncomingEventName, handler as Listener);
        reject(new Error(`sendAndWait timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const abortHandler = () => {
        if (rejected) return;
        rejected = true;
        clearTimeout(timer);
        this.off(responseEventName as IncomingEventName, handler as Listener);
        reject(new Error("sendAndWait aborted"));
      };

      if (abortSignal) {
        abortSignal.addEventListener("abort", abortHandler);
      }

      const handler = (response: OutgoingEvent) => {
        if (rejected) return;
        rejected = true;
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        this.off(responseEventName as IncomingEventName, handler as Listener);
        console.log(`[WS ← ${responseEventName}]`, response);
        resolve(response as T);
      };
      this.on(responseEventName as IncomingEventName, handler as Listener);
      console.log(`[WS → ${responseEventName}]`, payload);
      this.send(payload);
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