// useTTS — hook that plays TTS audio segments in order.
//
// Subscribes to `tts_audio` events (base64 WAV) from the core, decodes
// them, and plays them in order using a single AudioContext. Tracks
// playback state (playing, segment index) and drives the visualizer.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TtsAudioEvent } from "../lib/protocol";

export interface TtsPlaybackState {
  playing: boolean;
  currentSegment: number;
  totalSegments: number;
  analyser: AnalyserNode | null;
}

export function useTTS(
  subscribeTts: (fn: (e: TtsAudioEvent) => void) => () => void,
  onTtsEnded: (fn: () => void) => () => void,
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
      setPlaying(false);
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
    src.onended = () => {
      sourceRef.current = null;
      if (!stopRef.current) playNext();
    };
    src.start();
  }, []);

  useEffect(() => {
    const unsub = subscribeTts((ev: TtsAudioEvent) => {
      const ctx = ensureContext();
      if (ctx.state === "suspended") void ctx.resume();
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
  }, [subscribeTts, ensureContext, playNext]);

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
    sourceRef.current?.stop();
    sourceRef.current = null;
    stopRef.current = true;
    queueRef.current = [];
    playingRef.current = false;
    setPlaying(false);
  }, []);

  return { playing, currentSegment, totalSegments, analyser, stop };
}