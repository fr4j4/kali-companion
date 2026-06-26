import type { AvatarState, AvatarEmotion } from "./avatarConfig";

export interface DebugAvatarState {
  overrideState: AvatarState | null;
  overrideEmotion: AvatarEmotion | null;
}

let debugAvatarState: DebugAvatarState = {
  overrideState: null,
  overrideEmotion: null,
};

const listeners = new Set<(state: DebugAvatarState) => void>();

export function getDebugAvatarState(): DebugAvatarState {
  return debugAvatarState;
}

export function setDebugAvatarState(state: Partial<DebugAvatarState>): void {
  debugAvatarState = { ...debugAvatarState, ...state };
  listeners.forEach((listener) => listener(debugAvatarState));
}

export function resetDebugAvatarState(): void {
  debugAvatarState = { overrideState: null, overrideEmotion: null };
  listeners.forEach((listener) => listener(debugAvatarState));
}

export function subscribeDebugAvatarState(listener: (state: DebugAvatarState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
