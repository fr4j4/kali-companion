// useTTS — hook that plays TTS audio segments in order.
//
// Subscribes to `tts_audio` events (base64 WAV) and streamed
// `tts_audio_chunk` PCM from the core, and plays them in order on a single
// AudioContext. Streamed chunks are planned by PcmTimeline: `speech_started`
// goes out when a segment's first chunk starts to sound (that is when the
// core shows the block's emotion), `speech_ended` when its last chunk ends.
// Tracks playback state (playing, segment index) and drives the visualizer.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TtsAudioChunkEvent, TtsAudioEvent } from "../lib/protocol";
import { PcmTimeline } from "../lib/pcmTimeline";
import type { PresenceSignal } from "../avatar/presence";

export interface TtsPlaybackState {
  playing: boolean;
  currentSegment: number;
  totalSegments: number;
  analyser: AnalyserNode | null;
}

export function useTTS(
  subscribeTts: (fn: (e: TtsAudioEvent | TtsAudioChunkEvent) => void) => () => void,
  onTtsEnded: (fn: () => void) => () => void,
  onSignal?: (signal: PresenceSignal) => void,
): TtsPlaybackState & { stop: () => void } {
  const [playing, setPlaying] = useState(false);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [totalSegments, setTotalSegments] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const queueRef = useRef<Array<{ audio: AudioBuffer; segment: number; total: number }>>([]);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playingRef = useRef(false);
  const stopRef = useRef(false);
  const signalRef = useRef(onSignal);
  signalRef.current = onSignal;
  const timelineRef = useRef(new PcmTimeline());
  const pcmSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const pcmTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const turnRef = useRef(0);

  const syncPlaying = useCallback(() => {
    const active = playingRef.current || pcmSourcesRef.current.size > 0;
    setPlaying(active);
  }, []);

  const ensureContext = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = an;
      setAnalyser(an);
    }
    return ctxRef.current!;
  }, []);

  const playNext = useCallback(() => {
    const ctx = ctxRef.current;
    const an = analyserRef.current;
    if (!ctx || !an || stopRef.current) {
      playingRef.current = false;
      setPlaying(false);
      return;
    }
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      syncPlaying();
      return;
    }
    playingRef.current = true;
    setPlaying(true);
    setCurrentSegment(next.segment);
    setTotalSegments(next.total);
    const src = ctx.createBufferSource();
    src.buffer = next.audio;
    src.connect(an);
    sourceRef.current = src;
    const segment = next.segment;
    src.onended = () => {
      sourceRef.current = null;
      if (!stopRef.current) signalRef.current?.({ kind: "speech_ended", segment });
      if (!stopRef.current) playNext();
    };
    // A whole segment after streamed audio waits for it, and holds the clock while it plays.
    const startAt = Math.max(ctx.currentTime, timelineRef.current.busyUntil);
    timelineRef.current.reserve(startAt + next.audio.duration);
    const delayMs = (startAt - ctx.currentTime) * 1000;
    if (delayMs > 5) setTimeout(() => { if (!stopRef.current) signalRef.current?.({ kind: "speech_started", segment }); }, delayMs);
    else signalRef.current?.({ kind: "speech_started", segment });
    src.start(startAt);
  }, [syncPlaying]);

  const playChunk = useCallback((ev: TtsAudioChunkEvent) => {
    const ctx = ctxRef.current;
    const an = analyserRef.current;
    if (!ctx || !an) return;
    const timeline = timelineRef.current;
    const segment = ev.segment;
    const turn = turnRef.current;
    const finish = () => {
      if (!stopRef.current) signalRef.current?.({ kind: "speech_ended", segment });
    };
    if (ev.pcm.length > 0) {
      const buf = ctx.createBuffer(1, ev.pcm.length, ev.sample_rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < ev.pcm.length; i++) data[i] = ev.pcm[i] / 32768;
      const plan = timeline.schedule(segment, buf.duration, ctx.currentTime);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(an);
      pcmSourcesRef.current.add(src);
      src.onended = () => {
        pcmSourcesRef.current.delete(src);
        syncPlaying();
        // A chunk of an earlier turn ending must not close this turn's segment of the same number.
        if (!stopRef.current && turn === turnRef.current && timeline.chunkEnded(segment)) finish();
      };
      if (plan.first) {
        // Announce the segment when it really starts to sound, not when it arrived.
        const timer = setTimeout(() => {
          pcmTimersRef.current.delete(timer);
          if (stopRef.current || turn !== turnRef.current) return;
          setCurrentSegment(segment);
          signalRef.current?.({ kind: "speech_started", segment });
        }, Math.max(0, (plan.startAt - ctx.currentTime) * 1000));
        pcmTimersRef.current.add(timer);
      }
      src.start(plan.startAt);
      syncPlaying();
    }
    if (ev.final && timeline.markFinal(segment)) finish();
  }, [syncPlaying]);

  useEffect(() => {
    const unsub = subscribeTts((ev: TtsAudioEvent | TtsAudioChunkEvent) => {
      const ctx = ensureContext();
      if (ctx.state === "suspended") void ctx.resume();
      if (ev.event === "tts_audio_chunk") {
        // A new turn (segment 0 starts) clears a stale stop, as for whole segments.
        if (ev.segment === 0 && ev.seq === 0) {
          stopRef.current = false;
          turnRef.current += 1;
          timelineRef.current.newTurn();
        }
        if (stopRef.current) return; // stopped mid-turn: drop the rest of the stream
        playChunk(ev);
        return;
      }
      // Decode base64 → ArrayBuffer → AudioBuffer.
      const bytes = Uint8Array.from(atob(ev.audio), (c) => c.charCodeAt(0));
      ctx.decodeAudioData(
        bytes.buffer.slice(0),
        (audio) => {
          // On a new turn (segment 0), reset any stale stopRef so TTS
          // can play even if no turn_end arrived to clear it.
          if (ev.segment === 0) stopRef.current = false;
          queueRef.current.push({
            audio,
            segment: ev.segment,
            total: ev.total_segments > 0 ? ev.total_segments : -1,
          });
          if (!playingRef.current && !stopRef.current) playNext();
        },
        (err) => console.error("TTS decode error", err),
      );
    });
    return unsub;
  }, [subscribeTts, ensureContext, playNext, playChunk]);

  useEffect(() => {
    const unsub = onTtsEnded(() => {
      // turn_end arrived: let the queue drain, then mark stopped.
      if (queueRef.current.length === 0) {
        stopRef.current = false;
      }
    });
    return unsub;
  }, [onTtsEnded]);

  const stop = useCallback(() => {
    if (playingRef.current || pcmSourcesRef.current.size > 0) signalRef.current?.({ kind: "speech_cancelled" });
    sourceRef.current?.stop();
    sourceRef.current = null;
    stopRef.current = true;
    pcmTimersRef.current.forEach((t) => clearTimeout(t));
    pcmTimersRef.current.clear();
    pcmSourcesRef.current.forEach((src) => {
      src.onended = null;
      try { src.stop(); } catch { /* not started yet */ }
    });
    pcmSourcesRef.current.clear();
    timelineRef.current.reset();
    stopRef.current = true;
    queueRef.current = [];
    playingRef.current = false;
    setPlaying(false);
  }, []);

  return { playing, currentSegment, totalSegments, analyser, stop };
}