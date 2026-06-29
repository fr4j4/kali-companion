import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatusEvent, VoiceDesignPreset, QwenVoice } from "../../lib/protocol";
import { TTS_PROVIDERS } from "../../lib/tts-providers";
import type { TtsProviderId } from "../../lib/tts-providers";
import { SelectField, ToggleField } from "./fields";
import { VoiceDesignControls } from "./VoiceDesignControls";
import { VoicePreviewButton } from "./VoicePreviewButton";
import { useStage } from "../../stage/StageProvider";

interface Props {
  systemStatus: StatusEvent | null;
  voices: Record<string, unknown>[];
  tab: TtsProviderId;
  onUpdate: (patch: Record<string, unknown>) => void;
}

const MODES = ["normal", "whisper", "robotic", "radio", "deep"];
const TTS_LANGS = [
  { id: "auto", labelKey: "language.auto" },
  { id: "en", labelKey: "language.en" },
  { id: "es", labelKey: "language.es" },
];

export function VoiceControls({ systemStatus, voices, tab, onUpdate }: Props) {
  const { t } = useTranslation();
  const { customVoices, sttLanguage } = useStage();

  const activeProvider = systemStatus?.tts_provider ?? TTS_PROVIDERS.PIPER;
  const variant = systemStatus?.tts_variant ?? null;
  const currentVoice = systemStatus?.voice ?? "glados-es";
  const currentMode = systemStatus?.tts_mode ?? "normal";
  const autoTts = systemStatus?.auto_tts ?? true;

  const [instructions, setInstructions] = useState(t("voice.instructions_default"));
  const [seed, setSeed] = useState(-1);
  const [selectedPreset, setSelectedPreset] = useState("warm-female");

  const isTabQwen = tab === TTS_PROVIDERS.QWEN3;
  const isVoiceDesign = isTabQwen && variant === "voicedesign";
  const isCustomVoice = isTabQwen && variant === "customvoice";
  const isQwenNoModel = isTabQwen && !systemStatus?.tts_loaded;

  const qwenVoices = voices as unknown as QwenVoice[];
  const voiceDesignPresets = voices as unknown as VoiceDesignPreset[];

  const qwenVoiceIds = qwenVoices.map((v) => v.id);
  const effectiveVoice =
    isTabQwen && qwenVoiceIds.length > 0 && !qwenVoiceIds.includes(currentVoice)
      ? "serena"
      : currentVoice;

  const refreshCustomVoices = () => {
    window.dispatchEvent(new CustomEvent("refresh-custom-voices"));
  };

  if (activeProvider === TTS_PROVIDERS.UNAVAILABLE) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-xs text-err bg-err/10 rounded-md p-2">
          {systemStatus?.tts_error ?? t("settings.tts_unavailable")}
        </div>
        <ToggleField
          label={t("settings.tts_enabled")}
          checked={false}
          onChange={() => { }}
        />
      </div>
    );
  }

  if (isQwenNoModel) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-xs text-muted bg-surface-secondary rounded-md p-3">
          {t("settings.tts_qwen_no_model")}
        </div>
        <ToggleField
          label={t("settings.tts_enabled")}
          checked={autoTts}
          onChange={(v) => onUpdate({ auto_tts: v })}
        />
      </div>
    );
  }

  if (isVoiceDesign) {
    return (
      <div className="flex flex-col gap-4">
        <VoiceDesignControls
          presets={voiceDesignPresets}
          selectedPreset={selectedPreset}
          onSelectPreset={setSelectedPreset}
          instructions={instructions}
          onInstructionsChange={setInstructions}
          seed={seed}
          onSeedChange={setSeed}
          customVoices={customVoices}
          sttLanguage={sttLanguage}
          ttsProvider={tab}
          onCustomVoicesChange={refreshCustomVoices}
        />
        <ToggleField
          label={t("settings.tts_enabled")}
          checked={autoTts}
          onChange={(v) => onUpdate({ auto_tts: v })}
        />
      </div>
    );
  }

  if (isCustomVoice) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.voice")}</label>
          <div className="flex items-center gap-2">
            <select
              className="flex-1 bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
              value={effectiveVoice}
              onChange={(e) => onUpdate({ voice: e.target.value })}
            >
              {voices.length === 0 ? (
                <option value={effectiveVoice}>{effectiveVoice}</option>
              ) : (
                qwenVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.gender})
                  </option>
                ))
              )}
            </select>
            <VoicePreviewButton voiceId={effectiveVoice} sttLanguage={sttLanguage} provider={tab} />
          </div>
        </div>
        <p className="text-[11px] text-muted/60">{t("voice.qwen3_language_auto")}</p>
        <ToggleField
          label={t("settings.tts_enabled")}
          checked={autoTts}
          onChange={(v) => onUpdate({ auto_tts: v })}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted">{t("settings.voice")}</label>
        <div className="flex items-center gap-2">
          <select
            className="flex-1 bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
            value={currentVoice}
            onChange={(e) => onUpdate({ voice: e.target.value })}
          >
            {voices.length === 0 ? (
              <option value={currentVoice}>{currentVoice}</option>
            ) : (
              voices.map((v) => {
                const voiceId = (v.voice_id ?? v.id) as string;
                return (
                  <option key={voiceId} value={voiceId}>
                    {(v.name ?? voiceId) as string}
                  </option>
                );
              })
            )}
          </select>
          <VoicePreviewButton voiceId={currentVoice} sttLanguage={sttLanguage} mode={currentMode} provider={tab} />
        </div>
      </div>

      <SelectField
        label={t("settings.tts_mode")}
        value={currentMode}
        onChange={(v) => onUpdate({ tts_mode: v })}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {t(`voice.mode.${m}`)}
          </option>
        ))}
      </SelectField>

      <ToggleField
        label={t("settings.tts_enabled")}
        checked={autoTts}
        onChange={(v) => onUpdate({ auto_tts: v })}
      />

      <SelectField
        label={t("settings.tts_language")}
        value={sttLanguage}
        onChange={(v) => onUpdate({ stt_language: v })}
      >
        {TTS_LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {t(l.labelKey)}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
