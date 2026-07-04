import { useTranslation } from "react-i18next";
import type { StatusEvent } from "../../lib/protocol";
import { Select } from "../ui/Select";
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
          <Select
            value={currentVoice}
            onChange={(v) => onUpdate({ voice: v })}
            options={voices.length === 0
              ? [{ value: "", label: t("tts.status.not_loaded") }]
              : voices.map((v) => {
                  const voiceId = (v.voice_id ?? v.id) as string;
                  return { value: voiceId, label: (v.name ?? voiceId) as string };
                })
            }
            disabled={voices.length === 0}
            className="flex-1"
          />
          <VoicePreviewButton voiceId={currentVoice} sttLanguage={sttLanguage} mode={currentMode} provider="piper" />
        </div>
      </div>

      <SelectField
        label={t("settings.tts_mode")}
        value={currentMode}
        onChange={(v) => onUpdate({ tts_mode: v })}
        options={MODES.map((m) => ({ value: m, label: t(`voice.mode.${m}`) }))}
      />

      <SelectField
        label={t("settings.tts_language")}
        value={sttLanguage}
        onChange={(v) => onUpdate({ stt_language: v })}
        options={TTS_LANGS.map((l) => ({ value: l.id, label: t(l.labelKey) }))}
      />
    </div>
  );
}