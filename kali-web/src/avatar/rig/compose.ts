import { CATALOG } from "../avatarCatalog.gen";
import type { ActivityId, ChannelId, EmotionId, HaloTone, MouthShape, SymbolId } from "../avatarCatalog.gen";
import type { Channels } from "./types";

export const CHANNEL_IDS = Object.keys(CATALOG.channels) as ChannelId[];

export function neutralChannels(): Channels {
  const out = {} as Channels;
  for (const id of CHANNEL_IDS) out[id] = CATALOG.channels[id].neutral;
  return out;
}

export function clampChannel(id: ChannelId, value: number): number {
  const c = CATALOG.channels[id];
  return Math.min(c.max, Math.max(c.min, value));
}

/** Symbols need a minimum emotion strength to show (a faint feeling does not cry). */
const SYMBOL_THRESHOLD: Partial<Record<SymbolId, number>> = { tear: 0.7 };
const DEFAULT_SYMBOL_THRESHOLD = 0.5;
const MOUTH_THRESHOLD = 0.3;

export interface ComposeInput {
  activity: ActivityId;
  emotion: { id: EmotionId; intensity: number };
  /** 0..1 fade-out of the emotion near the end of its life. */
  fade: number;
  /** Additive channel offsets from the running gesture. */
  gesture?: Partial<Channels> | null;
  speechLevel: number;
}

export interface ComposeOutput {
  targets: Channels;
  mouthShape: MouthShape;
  symbol: SymbolId;
  tone: HaloTone;
  /** Effective emotion strength after the activity multiplier and fade. */
  strength: number;
}

type Deltas = Readonly<Partial<Record<ChannelId, number>>>;

/**
 * Pure composition: neutral + activity pose + emotion delta (scaled) + gesture, clamped.
 * Every (activity, emotion) pair is defined because the activity only scales the emotion.
 */
export function compose(input: ComposeInput): ComposeOutput {
  const activity = CATALOG.activities[input.activity] as {
    delta: Deltas; emotionMult: number; tone: HaloTone; mouth?: MouthShape; symbol?: SymbolId;
  };
  const emotion = CATALOG.emotions[input.emotion.id] as { delta: Deltas; mouth: MouthShape; symbol: SymbolId };
  const strength = Math.min(1, Math.max(0, input.emotion.intensity * input.fade * activity.emotionMult));
  const t = neutralChannels();
  for (const id of CHANNEL_IDS) {
    let v = t[id];
    v += activity.delta[id] ?? 0;
    v += (emotion.delta[id] ?? 0) * strength;
    v += input.gesture?.[id] ?? 0;
    t[id] = clampChannel(id, v);
  }
  t.mouthOpen = clampChannel("mouthOpen", Math.max(t.mouthOpen, input.speechLevel));
  const mouthShape: MouthShape = strength >= MOUTH_THRESHOLD ? emotion.mouth : activity.mouth ?? "neutral";
  let symbol: SymbolId = "none";
  if (activity.symbol) symbol = activity.symbol;
  else if (emotion.symbol !== "none" && strength >= (SYMBOL_THRESHOLD[emotion.symbol] ?? DEFAULT_SYMBOL_THRESHOLD)) symbol = emotion.symbol;
  return { targets: t, mouthShape, symbol, tone: activity.tone, strength };
}

/** Opacity of the brows: visible only while they express something (decision: "cejas solo al expresar"). */
export function browVisibility(browY: number, browAngle: number, browAsym: number): number {
  const m = Math.min(1, Math.abs(browY) * 1.6 + Math.abs(browAngle) * 1.4 + Math.abs(browAsym) * 1.2);
  const x = Math.min(1, Math.max(0, (m - 0.12) / 0.28));
  return x * x * (3 - 2 * x) * 0.92;
}
