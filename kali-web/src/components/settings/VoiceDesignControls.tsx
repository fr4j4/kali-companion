// VoiceDesignControls — UI for Qwen3 VoiceDesign mode.
//
// Renders preset selector, and conditionally shows instruction/seed/name controls
// only in custom mode (when no preset is selected). Custom voices list is always shown.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSidecarPort } from "../../hooks/useChat";
import type { CustomVoice, VoiceDesignPreset } from "../../lib/protocol";

function randomSeed() {
  return Math.floor(Math.random() * 999999);
}

export function VoiceDesignControls({
  presets = [],
  selectedPreset = "",
  onSelectPreset = () => {},
  instructions = "",
  onInstructionsChange = () => {},
  seed = -1,
  onSeedChange = () => {},
  customVoices = [],
  sttLanguage = "en",
  ttsProvider = "qwen3",
  onCustomVoicesChange = () => {},
}: {
  presets: VoiceDesignPreset[];
  selectedPreset: string;
  onSelectPreset: (id: string) => void;
  instructions: string;
  onInstructionsChange: (v: string) => void;
  seed: number;
  onSeedChange: (v: number) => void;
  customVoices: CustomVoice[];
  sttLanguage: string;
  ttsProvider: string;
  onCustomVoicesChange: () => void;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voiceName, setVoiceName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const isCustomMode = selectedPreset === "" || !selectedPreset;

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    setPlaying(false);
    setPreviewLoading(false);
  }, []);

  const doPreview = useCallback(async (currentInstructions: string, currentSeed: number) => {
    setPreviewLoading(true);
    setPlaying(false);
    try {
      const port = await getSidecarPort();
      const host = window.location.hostname;
      const resp = await fetch(
        `http://${host}:${port ?? 8900}/api/tts/voice-design`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instructions: currentInstructions,
            seed: currentSeed,
            language: sttLanguage,
            provider: ttsProvider,
          }),
        },
      );
      if (!resp.ok) {
        console.error("Voice design preview failed:", resp.status);
        setPreviewLoading(false);
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

      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      sourceRef.current = src;
      src.onended = () => {
        sourceRef.current = null;
        setPlaying(false);
      };
      setPreviewLoading(false);
      setPlaying(true);
      src.start();
    } catch (err) {
      console.error("VoiceDesignControls preview error:", err);
      setPreviewLoading(false);
      setPlaying(false);
    }
  }, [sttLanguage, ttsProvider]);

  const handlePreview = useCallback(() => {
    if (playing) {
      stop();
      return;
    }

    let currentInstructions: string;
    let currentSeed: number;

    if (isCustomMode) {
      const textArea = document.getElementById("voice-instructions") as HTMLTextAreaElement | null;
      const seedInput = document.getElementById("voice-seed") as HTMLInputElement | null;
      currentInstructions = textArea?.value ?? instructions;
      currentSeed = seedInput?.value ? parseInt(seedInput.value) : seed;
    } else {
      currentInstructions = instructions;
      currentSeed = seed;
    }

    doPreview(currentInstructions, currentSeed);
  }, [playing, stop, doPreview, instructions, seed, isCustomMode]);

  const handlePresetSelect = useCallback((id: string) => {
    onSelectPreset(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) {
      onInstructionsChange(preset.instructions);
      onSeedChange(preset.seed);
    }
  }, [presets, onSelectPreset, onInstructionsChange, onSeedChange]);

  const handleRandomSeed = useCallback(() => {
    onSeedChange(randomSeed());
  }, [onSeedChange]);

  const handleSaveVoice = useCallback(async () => {
    const trimmedName = voiceName.trim();
    if (!trimmedName || !instructions?.trim()) return;
    setSaving(true);
    try {
      const port = await getSidecarPort();
      const host = window.location.hostname;

      let currentInstructions: string;
      let currentSeed: number;
      if (isCustomMode) {
        const textArea = document.getElementById("voice-instructions") as HTMLTextAreaElement | null;
        const seedInput = document.getElementById("voice-seed") as HTMLInputElement | null;
        currentInstructions = textArea?.value ?? instructions;
        currentSeed = seedInput?.value ? parseInt(seedInput.value) : seed;
      } else {
        currentInstructions = instructions;
        currentSeed = seed;
      }

      const resp = await fetch(
        `http://${host}:${port ?? 8900}/voices/custom`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            provider: ttsProvider,
            instructions: currentInstructions,
            seed: currentSeed,
          }),
        },
      );
      if (resp.ok) {
        setVoiceName("");
        onCustomVoicesChange();
      } else {
        console.error("Failed to save custom voice:", resp.status);
      }
    } catch (err) {
      console.error("Save custom voice error:", err);
    } finally {
      setSaving(false);
    }
  }, [voiceName, instructions, seed, ttsProvider, onCustomVoicesChange, isCustomMode]);

  const handleDeleteVoice = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      const port = await getSidecarPort();
      const host = window.location.hostname;
      const resp = await fetch(
        `http://${host}:${port ?? 8900}/voices/custom/${id}`,
        { method: "DELETE" },
      );
      if (resp.ok) {
        onCustomVoicesChange();
      }
    } catch (err) {
      console.error("Delete custom voice error:", err);
    } finally {
      setDeletingId(null);
    }
  }, [onCustomVoicesChange]);

  const handlePreviewCustom = useCallback(async (cv: CustomVoice) => {
    if (playing) {
      stop();
      return;
    }
    doPreview(cv.instructions, cv.seed);
  }, [playing, stop, doPreview]);

  const canSave = voiceName.trim().length > 0 && (instructions?.trim() ?? "").length > 0 && !saving;

  const canPreview = playing || (isCustomMode
    ? !previewLoading && !!instructions?.trim() && seed >= 0
    : !previewLoading);

  return (
    <div className="flex flex-col gap-4">
      {/* Preset selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted">{t("voice_design.preset_label")}</label>
        <select
          className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
          value={selectedPreset}
          onChange={(e) => handlePresetSelect(e.target.value)}
        >
          <option value="">{t("voice_design.preset_custom")}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Custom mode controls - only show when no preset selected */}
      {isCustomMode && (
        <>
          {/* Instruction textarea */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">
              {t("voice_design.instruction_label")}{" "}
              <span className="text-muted/60 text-[10px]">{t("voice_design.instruction_must_be_english")}</span>
            </label>
            <textarea
              id="voice-instructions"
              className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim resize-none"
              rows={3}
              value={instructions}
              onChange={(e) => onInstructionsChange(e.target.value)}
              placeholder={t("voice_design.instruction_placeholder")}
            />
          </div>

          {/* Seed + Random */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{t("voice_design.seed_label")}</label>
            <div className="flex gap-2">
              <input
                id="voice-seed"
                type="number"
                className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim w-32"
                value={seed >= 0 ? seed : ""}
                onChange={(e) => onSeedChange(e.target.value ? parseInt(e.target.value) : -1)}
                placeholder={t("voice_design.seed_placeholder")}
              />
              <button
                type="button"
                onClick={handleRandomSeed}
                className="text-xs px-3 py-2 rounded border border-border text-muted hover:border-accent hover:text-accent transition-colors"
              >
                {t("voice_design.seed_random")}
              </button>
            </div>
          </div>

          {/* Voice name + Save */}
          <div className="flex gap-2 items-end">
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <input
                type="text"
                className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                placeholder={t("voice_design.voice_name_placeholder")}
                maxLength={50}
              />
            </div>
            <button
              type="button"
              onClick={handleSaveVoice}
              disabled={!canSave}
              className="text-xs px-3 py-2 rounded border border-accent text-accent hover:bg-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              {saving ? t("voice_design.saving") : t("voice_design.save")}
            </button>
          </div>
        </>
      )}

      {/* Preview button - always visible */}
      <button
        type="button"
        onClick={handlePreview}
        disabled={!canPreview}
        className={`text-xs px-3 py-2 rounded border transition-colors ${
          playing
            ? "border-err text-err hover:bg-err/10"
            : "border-border text-muted hover:border-accent hover:text-accent"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {previewLoading ? t("voice_design.generating") : playing ? t("voice_design.stop") : t("voice_design.preview")}
      </button>

      {/* Custom Voices list - always visible */}
      {customVoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted">{t("voice_design.my_custom_voices")}</label>
          <div className="flex flex-col gap-1.5">
            {customVoices.map((cv) => (
              <div key={cv.id} className="flex items-center gap-2 bg-surface border border-border rounded-md px-2.5 py-2">
                <span className="text-sm text-foreground flex-1 truncate">{cv.name}</span>
                <button
                  type="button"
                  onClick={() => handlePreviewCustom(cv)}
                  disabled={previewLoading}
                  className="text-[11px] px-2 py-1 rounded border border-border text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
                >
                  {t("voice_design.preview_custom")}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteVoice(cv.id)}
                  disabled={deletingId === cv.id}
                  className="text-[11px] px-2 py-1 rounded border border-border text-muted hover:border-err hover:text-err transition-colors disabled:opacity-50"
                >
                  {deletingId === cv.id ? t("voice_design.deleting") : t("voice_design.delete")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}