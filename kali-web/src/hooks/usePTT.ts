// usePTT — push-to-talk hook with WhatsApp-style recording.
//
// Three input modes:
//   ptt        — mic only on button press, one utterance per press
//   wake_word  — persistent mic + wake word detector, one utterance per trigger
//   continuous — persistent mic + always-on STT, every utterance auto-sent
//
// State machine:
//   idle → (wake_word enabled) → listening
//   idle → (continuous) → listening+continuous
//   listening → (PTT press / wake word) → recording
//   recording → (stt_final, wake_word mode) → listening   (auto audio_end)
//   recording → (stt_final, continuous) → listening+STT   (no audio_end)
//   recording → (stop) → listening / idle
//   recording → (cancel) → listening / idle

import { useCallback, useEffect, useRef, useState } from "react";
import type { WSClient } from "../lib/wsClient";
import type {
  SttPartialEvent,
  SttFinalEvent,
} from "../lib/protocol";

export type PTTState = "idle" | "listening" | "recording" | "processing";
export type InputMode = "ptt" | "wake_word" | "continuous";

export interface PTTControls {
  state: PTTState;
  partialText: string;
  finalText: string;
  wakeWordActive: boolean;
  inputMode: InputMode;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

interface Options {
  client: WSClient | null;
  wakeWordEnabled: boolean;
  inputMode?: InputMode;
  onWakeWord?: () => void;
}

// ── Inline downsample worklet (48 kHz → 16 kHz Int16 PCM) ──────────

const _DOWNSAMPLE_WORKLET = `
const BUFFER_TARGET = 5120;  // 320 ms at 16 kHz
class DownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = 48000 / 16000;
    this._buffer = [];
    this._accum = [];
    this._accumSamples = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const data = input[0];
    for (let i = 0; i < data.length; i++) {
      this._buffer.push(data[i]);
    }
    while (this._buffer.length >= this._ratio * 128) {
      const out = new Float32Array(128);
      for (let j = 0; j < 128; j++) {
        out[j] = this._buffer[Math.floor(j * this._ratio)] ?? 0;
      }
      this._buffer.splice(0, Math.floor(128 * this._ratio));
      this._accum.push(out);
      this._accumSamples += 128;
    }
    if (this._accumSamples >= BUFFER_TARGET) {
      const pcm = new Int16Array(this._accumSamples);
      let off = 0;
      for (const chunk of this._accum) {
        for (let j = 0; j < chunk.length; j++) {
          let s = chunk[j];
          s = Math.max(-1, Math.min(1, s));
          pcm[off++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this._accum = [];
      this._accumSamples = 0;
    }
    return true;
  }
}
registerProcessor("downsample-processor", DownsampleProcessor);
`.trim();

// ── Audio feedback beep ────────────────────────────────────────────

function _playBeep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {
    /* audio not available — skip beep */
  }
}

// ── Safe mic check ──────────────────────────────────────────────────

function _micAvailable(): boolean {
  return !!(
    navigator.mediaDevices?.getUserMedia
  );
}

const _MIC_UNAVAILABLE_MSG =
  "Micrófono no disponible. Accede via HTTPS o localhost para usar voz.";

// ── Hook ────────────────────────────────────────────────────────────

export function usePTT({
  client,
  wakeWordEnabled,
  inputMode = "wake_word",
  onWakeWord,
}: Options): PTTControls {
  const [state, setState] = useState<PTTState>("idle");
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [error, setError] = useState<string | null>(
    _micAvailable() ? null : _MIC_UNAVAILABLE_MSG
  );


  // Persistent audio resources (reused across recording sessions).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const listeningRef = useRef(false);    // persistent mic stream active
  const recordingRef = useRef(false);    // STT active on server
  const continuousRef = useRef(false);   // continuous mode flag
  const clientRef = useRef(client);
  clientRef.current = client;
  const onWakeWordRef = useRef(onWakeWord);
  onWakeWordRef.current = onWakeWord;

  // ── Subscribe to STT + wake word events ─────────────────

  useEffect(() => {
    if (!client) return;

    const onPartial = (p: unknown) => {
      const ev = p as SttPartialEvent;
      setPartialText(ev.text);
    };

    const onFinal = (p: unknown) => {
      const ev = p as SttFinalEvent;
      if (!ev.text) return;

      if (continuousRef.current) {
        // Continuous mode: keep STT alive, just forward the text.
        setFinalText(ev.text);
        setPartialText("");
        return;
      }

      // Wake-word / PTT mode: one utterance per session.
      if (!recordingRef.current) return;
      recordingRef.current = false;
      setFinalText(ev.text);
      setPartialText("");
      clientRef.current?.send({ event: "audio_end" });
      setState(listeningRef.current ? "listening" : "idle");
    };

    const onWakeWord = () => {
      onWakeWordRef.current?.();
      _playBeep();
      void startRecording();
    };

    client.on("stt_partial", onPartial as (p: unknown) => void);
    client.on("stt_final", onFinal as (p: unknown) => void);
    client.on("wake_word", onWakeWord as (p: unknown) => void);

    return () => {
      client.off("stt_partial", onPartial as (p: unknown) => void);
      client.off("stt_final", onFinal as (p: unknown) => void);
      client.off("wake_word", onWakeWord as (p: unknown) => void);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // ── Mode setup: start persistent stream ─────────────────

  useEffect(() => {
    const needsStream = wakeWordEnabled || inputMode === "continuous";
    if (needsStream) {
      continuousRef.current = inputMode === "continuous";
      setWakeWordActive(wakeWordEnabled);
      void startListening();
    } else {
      continuousRef.current = false;
      setWakeWordActive(false);
      stopListening();
    }
    return () => {
      continuousRef.current = false;
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled, inputMode]);

  // ── Audio pipeline setup / teardown ──────────────────────

  const startListening = useCallback(async () => {
    if (listeningRef.current) return;
    if (!_micAvailable()) {
      setError(_MIC_UNAVAILABLE_MSG);
      return;
    }
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micRef.current = stream;

      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor({ sampleRate: 48000 });
      audioCtxRef.current = ctx;

      const blob = new Blob([_DOWNSAMPLE_WORKLET], {
        type: "application/javascript",
      });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "downsample-processor");
      source.connect(node);

      node.port.onmessage = (e: MessageEvent) => {
        clientRef.current?.sendBinary(e.data as ArrayBuffer);
      };

      workletRef.current = node;
      listeningRef.current = true;

      // Continuous mode: start STT immediately.
      if (continuousRef.current) {
        recordingRef.current = true;
        clientRef.current?.send({ event: "audio_start", language: undefined });
        setState("recording");
      } else {
        setState("listening");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    recordingRef.current = false;

    if (workletRef.current) {
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    if (micRef.current) {
      micRef.current.getTracks().forEach((t) => t.stop());
      micRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    setPartialText("");
    setFinalText("");
    setState("idle");
  }, []);

  // ── Recording session control ────────────────────────────

  const startRecording = useCallback(async () => {
    if (recordingRef.current) return;
    setPartialText("");
    setFinalText("");

    // Persistent stream is already running — just start STT.
    if (listeningRef.current) {
      recordingRef.current = true;
      setState("recording");
      clientRef.current?.send({ event: "audio_start", language: undefined });
      return;
    }

    // One-off recording (PTT mode, no persistent stream).
    if (!_micAvailable()) {
      setError(_MIC_UNAVAILABLE_MSG);
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micRef.current = stream;

      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor({ sampleRate: 48000 });
      audioCtxRef.current = ctx;

      const blob = new Blob([_DOWNSAMPLE_WORKLET], {
        type: "application/javascript",
      });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "downsample-processor");
      source.connect(node);

      node.port.onmessage = (e: MessageEvent) => {
        clientRef.current?.sendBinary(e.data as ArrayBuffer);
      };

      workletRef.current = node;
      recordingRef.current = true;
      setState("recording");

      clientRef.current?.send({ event: "audio_start", language: undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const stop = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setState("processing");

    clientRef.current?.send({ event: "audio_end" });

    // One-off: destroy stream. Persistent: keep alive.
    if (!listeningRef.current) {
      if (workletRef.current) {
        workletRef.current.disconnect();
        workletRef.current = null;
      }
      if (micRef.current) {
        micRef.current.getTracks().forEach((t) => t.stop());
        micRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      setState("idle");
    }
  }, [client]);

  const cancel = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setPartialText("");
    setFinalText("");
    setState(listeningRef.current ? "listening" : "idle");

    clientRef.current?.send({ event: "audio_end" });

    if (!listeningRef.current) {
      if (workletRef.current) {
        workletRef.current.disconnect();
        workletRef.current = null;
      }
      if (micRef.current) {
        micRef.current.getTracks().forEach((t) => t.stop());
        micRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    }
  }, [client]);

  // ── Return ───────────────────────────────────────────────

  return {
    state,
    partialText,
    finalText,
    wakeWordActive,
    inputMode: continuousRef.current ? "continuous" : inputMode,
    error,
    start: startRecording,
    stop,
    cancel,
  };
}
