import { useTranslation } from "react-i18next";
import type { StatusEvent } from "../../lib/protocol";
import { SelectField } from "./fields";
import { VoicePreviewButton } from "./VoicePreviewButton";
import { useStage } from "../../stage/StageProvider";

interface Props {
  systemStatus: StatusEvent | null;
  voices: Record<string, unknown>[];
  onUpdate: (patch: Record<string, unknown>) => void;
}

const MODES = ["normal", "whisper", "robotic", "radio", "deep"];
const TTS_LANGS = [
  { id: "auto", labelKey: "language.auto" },
  { id: "en", labelKey: "language.en" },
  { id: "es", labelKey: "language.es" },
];

export function PiperVoiceControls({ systemStatus, voices, onUpdate }: Props) {
  const { t } = useTranslation();
  const { sttLanguage } = useStage();

  const currentVoice = systemStatus?.voice ?? "glados-es";
  const currentMode = systemStatus?.tts_mode ?? "normal";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted">{t("settings.voice")}</label>
        <div className="flex items-center gap-2">
          <select
            className="flex-1 bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim disabled:opacity-50"
            value={currentVoice}
            onChange={(e) => onUpdate({ voice: e.target.value })}
            disabled={voices.length === 0}
          >
            {voices.length === 0 ? (
              <option value="">{t("tts.status.not_loaded")}</option>
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
          <VoicePreviewButton voiceId={currentVoice} sttLanguage={sttLanguage} mode={currentMode} provider="piper" />
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