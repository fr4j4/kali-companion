import { useSyncExternalStore } from "react";
import { PresenceStore, type PresenceSnapshot } from "./presenceStore";

/** One store per window: the WebSocket client feeds it, every avatar view renders from it. */
export const presenceStore = new PresenceStore();

export function usePresence(store: PresenceStore = presenceStore): PresenceSnapshot {
  return useSyncExternalStore(store.subscribe, () => store.snapshot);
}

export type PresenceSignal =
  | { kind: "typing_start" | "typing_stop" | "pet" | "speech_cancelled" }
  | { kind: "speech_started" | "speech_ended"; segment: number }
  | { kind: "debug_override"; activity?: string | null; emotion?: string | null; intensity?: number; gesture?: string; hold?: boolean };

// Dev-only handle for the visual gallery and Playwright checks.
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __presence: PresenceStore }).__presence = presenceStore;
