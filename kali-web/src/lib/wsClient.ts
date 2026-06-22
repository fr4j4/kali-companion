// Typed WebSocket client implementing the kali-yarn protocol.
//
// Wraps a WebSocket connection, dispatches events by name to typed
// listeners, and provides helpers for sending events to the core.

import type { OutgoingEvent, EventName } from "./protocol";

type Listener = (payload: OutgoingEvent) => void;
type IncomingEventName = EventName;

export class WSClient {
  private url: string;
  private ws: WebSocket | null = null;
  private listeners = new Map<IncomingEventName, Set<Listener>>();
  private reconnectDelay = 1000;
  private shouldReconnect = true;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.send({ event: "hello", client: "kali-web", version: "0.1.0" } as Record<string, unknown>);
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

  send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
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
  }
}