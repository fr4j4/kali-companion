// usePTT — push-to-talk hook with WhatsApp-style recording.
//
// Input modes:
//   ptt        — mic only on button press, one utterance per press. Wake word
//                can be enabled inside PTT, which keeps the mic open and lets
//                the wake word trigger a recording.
//   continuous — persistent mic + always-on STT, every utterance auto-sent
//
// VAD (silence detection) runs in the frontend AudioWorklet via RMS energy
// gating. When a wake-word-initiated recording detects sustained silence
// (RMS below threshold for the configured timeout), the hook auto-ends the
// recording. The mic level is exposed via a ref (updated ~3fps) so the UI
// can render a live meter without triggering React re-renders.
//
// State machine:
//   idle → (PTT + wake word enabled) → listening
//   idle → (continuous) → listening+continuous
//   listening → (PTT press / wake word) → recording
//   recording → (silence timeout, wake word origin) → processing (auto audio_end)
//   recording → (stt_final, manual origin) → idle                (manual audio_end)
//   recording → (stt_final, continuous) → listening+STT         (no audio_end)
//   recording → (stop) → listening / idle
//   recording → (cancel) → listening / idle

import { useCallback, useEffect, useRef, useState } from "react";
import type { WSClient } from "../lib/wsClient";
import type {
  SttPartialEvent,
  SttFinalEvent,
  VadStateEvent,
} from "../lib/protocol";

export type PTTState = "idle" | "listening" | "recording" | "processing";
export type InputMode = "ptt" | "continuous";

export interface PTTControls {
  state: PTTState;
  partialText: string;
  finalText: string;
  sttProvider: string;
  isSpeaking: boolean;
  wakeWordActive: boolean;
  inputMode: InputMode;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  // VAD — mic level meter + calibration
  micLevelRef: React.RefObject<number>;
  rmsThreshold: number;
  calibrating: boolean;
  calibrate: () => void;
}

interface Options {
  client: WSClient | null;
  sttEnabled: boolean;
  wakeWordEnabled: boolean;
  inputMode?: InputMode;
  onWakeWord?: () => void;
  vadSilenceTimeout?: number;
  vadAutoCalibrate?: boolean;
  vadRmsThreshold?: number;
  onVadSettingsChange?: (patch: { stt_vad_rms_threshold?: number }) => void;
}

// ── Inline downsample worklet (48 kHz → 16 kHz Int16 PCM + RMS) ─────

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
      let sumSq = 0;
      let off = 0;
      for (const chunk of this._accum) {
        for (let j = 0; j < chunk.length; j++) {
          let s = chunk[j];
          s = Math.max(-1, Math.min(1, s));
          pcm[off++] = s < 0 ? s * 0x8000 : s * 0x7fff;
          const f = chunk[j];
          sumSq += f * f;
        }
      }
      const rms = Math.sqrt(sumSq / this._accumSamples);
      this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
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

// Number of RMS samples to collect during calibration (~2s at 320ms/chunk).
const _CALIBRATION_SAMPLES = 6;
// Multiplier applied to the measured noise floor to derive the threshold.
const _CALIBRATION_MULTIPLIER = 2.5;
// Minimum threshold to avoid setting it so low that background noise never triggers.
const _MIN_THRESHOLD = 0.005;

// ── Hook ────────────────────────────────────────────────────────────

export function usePTT({
  client,
  sttEnabled = true,
  wakeWordEnabled,
  inputMode = "ptt",
  onWakeWord,
  vadSilenceTimeout = 1.0,
  vadAutoCalibrate = true,
  vadRmsThreshold = 0.015,
  onVadSettingsChange,
}: Options): PTTControls {
  const [state, setState] = useState<PTTState>("idle");
  const [partialText, setPartialText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [sttProvider, setSttProvider] = useState("vosk");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [error, setError] = useState<string | null>(
    _micAvailable() ? null : _MIC_UNAVAILABLE_MSG
  );
  const [rmsThreshold, setRmsThreshold] = useState(vadRmsThreshold);
  const [calibrating, setCalibrating] = useState(false);

  // Persistent audio resources (reused across recording sessions).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const listeningRef = useRef(false);    // persistent mic stream active
  const recordingRef = useRef(false);    // STT active on server
  const continuousRef = useRef(false);   // continuous mode flag
  const cancelledRef = useRef(false);    // true if current recording was cancelled
  const clientRef = useRef(client);
  clientRef.current = client;
  const onWakeWordRef = useRef(onWakeWord);
  onWakeWordRef.current = onWakeWord;
  const inputModeRef = useRef(inputMode);
  inputModeRef.current = inputMode;
  const sttEnabledRef = useRef(sttEnabled);
  sttEnabledRef.current = sttEnabled;

  // VAD refs — high-frequency values use refs to avoid re-renders.
  const micLevelRef = useRef(0);          // RMS of the latest chunk (0-1), updated ~3fps
  const silenceStartRef = useRef<number | null>(null);
  const rmsThresholdRef = useRef(vadRmsThreshold);
  rmsThresholdRef.current = rmsThreshold;
  const silenceTimeoutRef = useRef(vadSilenceTimeout);
  silenceTimeoutRef.current = vadSilenceTimeout;
  const recordingOriginRef = useRef<string | null>(null);
  const autoCalibrateRef = useRef(vadAutoCalibrate);
  autoCalibrateRef.current = vadAutoCalibrate;
  const calibratingRef = useRef(false);
  const calibrationSamplesRef = useRef<number[]>([]);
  const onVadSettingsChangeRef = useRef(onVadSettingsChange);
  onVadSettingsChangeRef.current = onVadSettingsChange;

  // ── VAD audio processing (runs inside onmessage) ────────

  const processRms = useCallback((rms: number) => {
    // Always update micLevelRef for the live meter (no setState — avoids re-renders).
    micLevelRef.current = rms;

    // Calibration mode: collect samples, compute threshold when done.
    if (calibratingRef.current) {
      calibrationSamplesRef.current.push(rms);
      if (calibrationSamplesRef.current.length >= _CALIBRATION_SAMPLES) {
        const samples = calibrationSamplesRef.current;
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        const newThreshold = Math.max(avg * _CALIBRATION_MULTIPLIER, _MIN_THRESHOLD);
        rmsThresholdRef.current = newThreshold;
        setRmsThreshold(newThreshold);
        calibratingRef.current = false;
        setCalibrating(false);
        calibrationSamplesRef.current = [];
        // Persist the calibrated threshold to backend.
        onVadSettingsChangeRef.current?.({ stt_vad_rms_threshold: newThreshold });
      }
      return;
    }

    // Auto-end logic: only for wake-word-initiated recordings.
    if (!recordingRef.current) return;
    const threshold = rmsThresholdRef.current;

    if (rms > threshold) {
      // Speech detected — reset silence counter.
      silenceStartRef.current = null;
      if (!isSpeaking) setIsSpeaking(true);
    } else {
      // Silence detected.
      if (silenceStartRef.current === null) {
        silenceStartRef.current = Date.now();
      }
      if (isSpeaking) setIsSpeaking(false);

      // Auto-end only when the recording was triggered by the wake word.
      if (recordingOriginRef.current === "wake_word") {
        const elapsed = Date.now() - silenceStartRef.current;
        if (elapsed >= silenceTimeoutRef.current * 1000) {
          silenceStartRef.current = null;
          // Trigger stop (sends audio_end). Use ref to avoid stale closure.
          stopRef.current();
        }
      }
    }
  }, [isSpeaking]);

  // ── Subscribe to STT + wake word events ─────────────────

  // stopRef lets processRms call the latest stop() without a stale closure.
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!client) return;

    const onPartial = (p: unknown) => {
      const ev = p as SttPartialEvent;
      setPartialText(ev.text);
    };

    const onFinal = (p: unknown) => {
      const ev = p as SttFinalEvent;
      if (ev.provider) setSttProvider(ev.provider);

      if (continuousRef.current) {
        // Continuous mode: keep STT alive, just forward the text.
        if (ev.text) {
          setFinalText(ev.text);
          setPartialText("");
        }
        return;
      }

      // Wake-word / PTT mode: one utterance per session.
      if (!recordingRef.current) return;
      if (cancelledRef.current) {
        cancelledRef.current = false;
        setIsSpeaking(false);
        return;
      }
      recordingRef.current = false;
      recordingOriginRef.current = null;
      silenceStartRef.current = null;
      setIsSpeaking(false);
      setFinalText(ev.text);
      setPartialText("");
      setState(listeningRef.current ? "listening" : "idle");
    };

    const onVadState = (p: unknown) => {
      // Backend VAD state is optional supplementary info; the frontend
      // RMS gate is the primary source for isSpeaking.
      const ev = p as VadStateEvent;
      void ev;
    };

    const onWakeWord = () => {
      if (recordingRef.current) return; // ignore wake word while already recording
      onWakeWordRef.current?.();
      _playBeep();
      void startRecording("wake_word");
    };

    const onSttError = () => {
      recordingRef.current = false;
      recordingOriginRef.current = null;
      silenceStartRef.current = null;
      setIsSpeaking(false);
      setPartialText("");
      setFinalText("");
      setState(listeningRef.current ? "listening" : "idle");
    };

    client.on("stt_partial", onPartial as (p: unknown) => void);
    client.on("stt_final", onFinal as (p: unknown) => void);
    client.on("vad_state", onVadState as (p: unknown) => void);
    client.on("wake_word", onWakeWord as (p: unknown) => void);
    client.on("error", onSttError as (p: unknown) => void);

    return () => {
      client.off("stt_partial", onPartial as (p: unknown) => void);
      client.off("stt_final", onFinal as (p: unknown) => void);
      client.off("vad_state", onVadState as (p: unknown) => void);
      client.off("wake_word", onWakeWord as (p: unknown) => void);
      client.off("error", onSttError as (p: unknown) => void);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // ── Mode setup: start persistent stream ─────────────────

  useEffect(() => {
    const needsStream = inputMode === "continuous" || (inputMode === "ptt" && wakeWordEnabled);
    const prevMode = continuousRef.current ? "continuous" : inputModeRef.current;
    const nextMode = inputMode;
    const modeChanged = prevMode !== nextMode;

    if (needsStream) {
      continuousRef.current = inputMode === "continuous";
      setWakeWordActive(inputMode === "ptt" && wakeWordEnabled);
      // When switching between continuous and wake-word PTT, the mic is already
      // open but the STT session origin differs. Tear down and rebuild the
      // stream so the next audio_start carries the correct origin.
      if (listeningRef.current && modeChanged) {
        stopListening();
      }
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
    if (!sttEnabledRef.current) return;
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
        const data = e.data as { pcm: ArrayBuffer; rms: number };
        clientRef.current?.sendBinary(data.pcm);
        processRms(data.rms);
      };

      workletRef.current = node;
      listeningRef.current = true;

      // Continuous mode: start STT immediately.
      if (continuousRef.current) {
        recordingRef.current = true;
        recordingOriginRef.current = "continuous";
        clientRef.current?.send({ event: "audio_start", language: undefined, origin: "continuous" });
        setState("recording");
      } else {
        setState("listening");
      }

      // Auto-calibrate when wake word is enabled and auto-calibrate is on.
      if (autoCalibrateRef.current && inputMode === "ptt" && wakeWordEnabled) {
        startCalibration();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, processRms]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    recordingRef.current = false;
    recordingOriginRef.current = null;
    silenceStartRef.current = null;

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

  const startRecording = useCallback(async (origin: "manual" | "wake_word" | "continuous" = "manual") => {
    if (!sttEnabledRef.current) return;
    if (recordingRef.current) return;
    cancelledRef.current = false;
    setIsSpeaking(false);
    setPartialText("");
    setFinalText("");
    silenceStartRef.current = null;
    recordingOriginRef.current = origin;

    // Persistent stream is already running — just start STT.
    if (listeningRef.current) {
      recordingRef.current = true;
      setState("recording");
      clientRef.current?.send({ event: "audio_start", language: undefined, origin });
      return;
    }

    // One-off recording (PTT mode without wake word).
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
        const data = e.data as { pcm: ArrayBuffer; rms: number };
        clientRef.current?.sendBinary(data.pcm);
        processRms(data.rms);
      };

      workletRef.current = node;
      recordingRef.current = true;
      setState("recording");

      clientRef.current?.send({ event: "audio_start", language: undefined, origin });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, processRms]);

  const stop = useCallback(() => {
    if (!recordingRef.current) return;
    setState("processing");

    // Send audio_end to request final transcript.
    clientRef.current?.send({ event: "audio_end" });

    // Reset VAD state.
    silenceStartRef.current = null;
    recordingOriginRef.current = null;

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

  // Keep stopRef in sync so processRms can call the latest stop().
  stopRef.current = stop;

  const cancel = useCallback(() => {
    if (!recordingRef.current) return;
    cancelledRef.current = true;
    recordingRef.current = false;
    recordingOriginRef.current = null;
    silenceStartRef.current = null;
    setIsSpeaking(false);
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

  // ── Calibration ─────────────────────────────────────────

  const startCalibration = useCallback(() => {
    calibrationSamplesRef.current = [];
    calibratingRef.current = true;
    setCalibrating(true);
  }, []);

  const calibrate = useCallback(() => {
    // Only meaningful when the mic stream is active.
    if (!listeningRef.current) return;
    startCalibration();
  }, [startCalibration]);

  // ── Return ───────────────────────────────────────────────

  return {
    state,
    partialText,
    finalText,
    sttProvider,
    isSpeaking,
    wakeWordActive,
    inputMode: continuousRef.current ? "continuous" : inputMode,
    error,
    start: () => startRecording("manual"),
    stop,
    cancel,
    micLevelRef,
    rmsThreshold,
    calibrating,
    calibrate,
  };
}