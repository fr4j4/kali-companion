import type { ActivityId, AttentionId, ChannelId, EmotionId, GestureId, HaloTone, MouthShape, SymbolId } from "../avatarCatalog.gen";

export type Channels = Record<ChannelId, number>;

/** Semantic avatar state published by the core (`presence_state`, v2). Times are core clock (ms). */
export interface PresenceFrame {
  event: "presence_state";
  v: 2;
  session_id: string;
  seq: number;
  t: number;
  connected: boolean;
  activity: { id: ActivityId; since: number; detail?: { tool?: string } };
  emotion: { id: EmotionId; intensity: number; since: number; until: number; source: string };
  gesture: { id: GestureId; gid: number; at: number } | null;
  speech: { active: boolean; segment: number; started_at: number; duration: number; env_hz: number; env: string; estimated: boolean } | null;
  attention: AttentionId;
}

/** Everything a renderer needs for one paint; all values already smoothed. */
export interface RenderState {
  eyeOpenL: number; eyeOpenR: number; lowerLid: number; lidSlant: number;
  pupilScale: number; pupilSlit: number; pupilX: number; pupilY: number;
  browY: number; browAngle: number; browAsym: number;
  blush: number; earL: number; earR: number;
  headTilt: number; headX: number; headY: number; bodyY: number; bodyScale: number;
  mouthOpen: number; mouthShape: MouthShape; symbol: SymbolId; symbolOpacity: number;
  tone: HaloTone; halo: number; haloScale: number; whisker: number; asleep: boolean;
}

export interface RigRenderer {
  render(state: RenderState): void;
}

/** Normalised gaze targets in [-1, 1] relative to the avatar centre, fed by the host view. */
export interface GazePoints {
  cursor?: { x: number; y: number } | null;
  input?: { x: number; y: number } | null;
  thought?: { x: number; y: number } | null;
}
