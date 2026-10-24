// PcmTimeline — plans streamed TTS chunks on one audio clock, without gaps or overlaps.
//
// Pure bookkeeping (no Web Audio) so it can be tested: the caller passes the
// AudioContext time and creates the sources. It tells the caller when a
// segment's first chunk starts to sound (to send `speech_started` at that
// instant, not at network arrival) and when its last chunk has finished
// (`speech_ended`, only after the segment's final frame).

interface SegmentState {
  pending: number;
  final: boolean;
  started: boolean;
  done: boolean;
}

export interface PlannedChunk {
  startAt: number;
  endAt: number;
  /** First chunk of its segment: its start is when the segment starts to sound. */
  first: boolean;
}

export class PcmTimeline {
  private nextAt = 0;
  private segments = new Map<number, SegmentState>();

  /** @param lead jitter buffer (s) before the first chunk after the timeline was idle. */
  constructor(private readonly lead = 0.12) {}

  private seg(segment: number): SegmentState {
    let st = this.segments.get(segment);
    if (!st) {
      st = { pending: 0, final: false, started: false, done: false };
      this.segments.set(segment, st);
    }
    return st;
  }

  /** Audio time at which everything planned so far has finished. */
  get busyUntil(): number {
    return this.nextAt;
  }

  /** Keep the clock busy until `until` (e.g. a whole WAV segment playing on the same context). */
  reserve(until: number): void {
    this.nextAt = Math.max(this.nextAt, until);
  }

  schedule(segment: number, duration: number, now: number): PlannedChunk {
    const st = this.seg(segment);
    // Idle or underrun: restart behind a fresh jitter buffer instead of clipping the chunk.
    const startAt = this.nextAt > now ? this.nextAt : now + this.lead;
    const first = !st.started;
    st.started = true;
    st.pending += 1;
    this.nextAt = startAt + Math.max(0, duration);
    return { startAt, endAt: this.nextAt, first };
  }

  /** A chunk of `segment` finished sounding. True when the whole segment has sounded. */
  chunkEnded(segment: number): boolean {
    const st = this.seg(segment);
    st.pending = Math.max(0, st.pending - 1);
    return this.settle(st);
  }

  /** The segment's final frame arrived. True when it had already finished sounding. */
  markFinal(segment: number): boolean {
    const st = this.seg(segment);
    st.final = true;
    return this.settle(st);
  }

  private settle(st: SegmentState): boolean {
    if (st.done || !st.final || st.pending > 0 || !st.started) return false;
    st.done = true;
    return true;
  }

  /** A new turn reuses segment numbers from 0: forget them, but keep the clock. */
  newTurn(): void {
    this.segments.clear();
  }

  reset(): void {
    this.nextAt = 0;
    this.segments.clear();
  }
}
