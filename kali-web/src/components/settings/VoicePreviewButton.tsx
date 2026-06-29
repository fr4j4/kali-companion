// VoicePreviewButton — play a TTS voice preview from the settings panel.
//
// When clicked, POSTs to /api/tts/preview with the voice_id and the current
// STT language, then plays the returned WAV via Web Audio API.
// The backend selects a random preview text for the given language.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSidecarPort } from "../../hooks/useChat";

export function VoicePreviewButton({
  voiceId,
  sttLanguage = "en",
  mode,
  provider = "piper",
}: {
  voiceId: string;
  sttLanguage?: string;
  mode?: string;
  provider?: string;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    ctxRef.current?.close();
    ctxRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    if (playing) {
      stop();
      return;
    }
    try {
      const port = await getSidecarPort();
      const host = window.location.hostname;
      const resp = await fetch(
        `http://${host}:${port ?? 8900}/api/tts/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voice_id: voiceId, language: sttLanguage, mode, provider }),
        },
      );
      if (!resp.ok) {
        console.error("Preview failed:", resp.status);
        return;
      }
      const arrayBuffer = await resp.arrayBuffer();

      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!ctxRef.current) {
        ctxRef.current = new Ctor();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        ctx.decodeAudioData(arrayBuffer, resolve, reject);
      });

      setPlaying(true);
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      sourceRef.current = src;
      src.onended = () => {
        sourceRef.current = null;
        setPlaying(false);
      };
      src.start();
    } catch (err) {
      console.error("VoicePreviewButton error:", err);
      setPlaying(false);
    }
  }, [voiceId, sttLanguage, mode, provider, playing, stop]);

  return (
    <button
      type="button"
      onClick={play}
      className={`text-xs px-2 py-1 rounded border transition-colors ${
        playing
          ? "border-err text-err hover:bg-err/10"
          : "border-border text-muted hover:border-accent hover:text-accent"
      }`}
    >
      {playing ? t("voice_design.stop_button") : t("voice_design.preview_button")}
    </button>
  );
}
