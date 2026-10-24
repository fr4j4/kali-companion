import { CATALOG } from "../avatarCatalog.gen";
import type { ChannelId, GestureId } from "../avatarCatalog.gen";
import type { Channels } from "./types";

type Track = { readonly ch: ChannelId; readonly keys?: ReadonlyArray<readonly [number, number]>; readonly osc?: { readonly amp: number; readonly hz: number } };
export interface GestureDef { readonly durMs: number; readonly priority: number; readonly origin: string; readonly semantic: boolean; readonly tracks: readonly Track[] }

/** Channels that move the body or head: dropped (not faded) in reduced-motion mode. */
export const MOTION_CHANNELS: ReadonlySet<ChannelId> = new Set<ChannelId>(["bodyY", "headY", "headTilt", "gazeX", "gazeY"]);

export function gestureDef(id: GestureId): GestureDef {
  return CATALOG.gestures[id] as unknown as GestureDef;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

function sampleKeys(keys: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0 || 1));
    }
  }
  return keys[keys.length - 1][1];
}

/** Additive channel offsets of a gesture `elapsedMs` after it started. Empty once finished. */
export function sampleGesture(def: GestureDef, elapsedMs: number, opts: { reduced?: boolean } = {}): Partial<Channels> {
  const out: Partial<Channels> = {};
  if (elapsedMs < 0 || elapsedMs > def.durMs) return out;
  const t = elapsedMs / def.durMs;
  for (const track of def.tracks) {
    if (opts.reduced && (MOTION_CHANNELS.has(track.ch) || track.osc)) continue;
    let v = 0;
    if (track.keys) v = sampleKeys(track.keys, t);
    else if (track.osc) v = track.osc.amp * Math.sin(2 * Math.PI * track.osc.hz * (elapsedMs / 1000)) * Math.min(1, t / 0.15, (1 - t) / 0.15);
    out[track.ch] = (out[track.ch] ?? 0) + v;
  }
  return out;
}
