// VoiceSection — voice, TTS mode, auto-TTS, STT language.

import { useTranslation } from "react-i18next";
import type { StatusEvent } from "../../lib/protocol";
import { SelectField, ToggleField } from "./fields";

interface Props {
  systemStatus: StatusEvent | null;
  voices: { id: string; name: string }[];
  onUpdate: (patch: Record<string, unknown>) => void;
}

const MODES = ["normal", "whisper", "robotic", "radio", "deep"];
const STT_LANGS = [
  { id: "es", labelKey: "language.es" },
  { id: "en", labelKey: "language.en" },
];

export function VoiceSection({ systemStatus, voices, onUpdate }: Props) {
  const { t } = useTranslation();

  const currentVoice = systemStatus?.voice ?? "glados-es";
  const currentMode = systemStatus?.tts_mode ?? "normal";
  const autoTts = systemStatus?.auto_tts ?? true;
  const sttLanguage = systemStatus?.stt_language ?? "es";

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label={t("settings.voice")}
        value={currentVoice}
        onChange={(v) => onUpdate({ voice: v })}
      >
        {voices.length === 0 ? (
          <option value={currentVoice}>{currentVoice}</option>
        ) : (
          voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))
        )}
      </SelectField>

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
        label={t("settings.stt_language")}
        value={sttLanguage}
        onChange={(v) => onUpdate({ stt_language: v })}
      >
        {STT_LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {t(l.labelKey)}
          </option>
        ))}
      </SelectField>
    </div>
  );
}