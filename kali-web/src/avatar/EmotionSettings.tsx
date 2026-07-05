import { Brain } from "lucide-react";
import { SectionHeader } from "../components/settings/SectionHeader";
import { SettingsCard } from "../components/settings/SettingsCard";
import { SelectField } from "../components/settings/fields";

const EMOTION_PROVIDER_KEY = "kali.emotion_provider";

export type EmotionProviderType = "llm" | "local";

export function getEmotionProviderSetting(): EmotionProviderType {
  const stored = localStorage.getItem(EMOTION_PROVIDER_KEY);
  if (stored === "llm" || stored === "local") return stored;
  return "llm";
}

export function setEmotionProviderSetting(value: EmotionProviderType): void {
  localStorage.setItem(EMOTION_PROVIDER_KEY, value);
}

const PROVIDER_OPTIONS = [
  { value: "llm", label: "LLM (recomendado)" },
  { value: "local", label: "Modelo local" },
];

export function EmotionSettings() {
  const value = getEmotionProviderSetting();

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Brain}
        title="Emociones del avatar"
        description="Selecciona cómo se determinan las emociones del avatar."
      />

      <SettingsCard title="Mecanismo de emoción">
        <SelectField
          label="Proveedor"
          value={value}
          onChange={(v) => setEmotionProviderSetting(v as EmotionProviderType)}
          options={PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          helperText={
            value === "local"
              ? "Próximamente — inferencia local de emociones"
              : undefined
          }
        />
      </SettingsCard>
    </div>
  );
}
