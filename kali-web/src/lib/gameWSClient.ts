// GameWSClient — dedicated WebSocket connection for games.
//
// This is a singleton shared by all game-related components (GameWidget,
// TicTacToeView, GameReasoningPanel, etc.) so game events travel over a
// single connection instead of spawning one per useChat() call.
//
// The underlying WSClient already reconnects automatically on close, so we
// keep the same instance and reuse it while it is connected.

import { useEffect, useState } from "react";
import { WSClient } from "./wsClient";
import { getSidecarPort } from "../hooks/useChat";

let client: WSClient | null = null;
let connectPromise: Promise<WSClient> | null = null;

export async function getGameWSClient(): Promise<WSClient> {
  if (client?.isConnected()) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const port = await getSidecarPort();
    if (!port) {
      connectPromise = null;
      throw new Error("No sidecar port available");
    }

    const isElectron = !!(window as unknown as { kali?: unknown }).kali;
    let wsUrl: string;
    if (isElectron) {
      wsUrl = `ws://127.0.0.1:${port}/ws`;
    } else {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${proto}//${window.location.host}/ws`;
    }

    const c = new WSClient(wsUrl);

    c.connect();
    client = c;

    // Wait until the connection is open before resolving.
    if (!c.isConnected()) {
      await new Promise<void>((resolve, reject) => {
        const onConnected = () => done();
        const onError = () => {
          c.off("error", onError);
          c.off("connected", onConnected);
          c.off("ready", onConnected);
          reject(new Error("Game WS connection failed"));
        };
        const done = () => {
          c.off("error", onError);
          c.off("connected", onConnected);
          c.off("ready", onConnected);
          resolve();
        };

        const timer = setTimeout(() => {
          c.off("error", onError);
          c.off("connected", onConnected);
          c.off("ready", onConnected);
          reject(new Error("Game WS connection timeout"));
        }, 10000);

        const wrappedDone = () => {
          clearTimeout(timer);
          done();
        };

        c.on("connected", wrappedDone);
        c.on("ready", wrappedDone);
        c.on("error", onError);
      });
    }

    return c;
  })().catch((err) => {
    connectPromise = null;
    throw err;
  });

  return connectPromise;
}

export function useGameWS(): WSClient | null {
  const [ws, setWs] = useState<WSClient | null>(null);

  useEffect(() => {
    let cancelled = false;

    getGameWSClient()
      .then((c) => {
        if (!cancelled) setWs(c);
      })
      .catch(() => {
        // Keep null; the component will re-render when the connection succeeds.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return ws;
}
