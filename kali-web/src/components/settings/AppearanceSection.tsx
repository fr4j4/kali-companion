// AppearanceSection — theme, UI scale, canvas auto-expand, language.

import { useTranslation } from "react-i18next";
import { SelectField, SliderField, ToggleField } from "./fields";

interface Props {
  theme: string;
  onThemeChange: (t: string) => void;
  canvasAutoExpand: boolean;
  onCanvasAutoExpandChange: (v: boolean) => void;
  uiScale: { global: number; text: number; avatar: number; window: number; density: number };
  onUIScaleChange: (patch: Record<string, number>) => void;
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;
}

const THEMES = ["amberwave", "foxglove", "vellum", "tidepool"];
const LANGS = [
  { id: "en", labelKey: "language.en" },
  { id: "es", labelKey: "language.es" },
];

export function AppearanceSection({
  theme,
  onThemeChange,
  canvasAutoExpand,
  onCanvasAutoExpandChange,
  uiScale,
  onUIScaleChange,
  currentLanguage,
  onLanguageChange,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label={t("settings.theme")}
        value={theme}
        onChange={onThemeChange}
      >
        {THEMES.map((tname) => (
          <option key={tname} value={tname}>
            {t(`theme.${tname}`)}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={t("settings.language")}
        value={currentLanguage}
        onChange={onLanguageChange}
      >
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {t(l.labelKey)}
          </option>
        ))}
      </SelectField>

      <div className="flex flex-col gap-3 border-t border-border pt-3 mt-1">
        <label className="text-xs text-muted font-semibold">{t("settings.appearance")}</label>

        <SliderField
          label={t("settings.scale_global")}
          value={uiScale.global}
          min={0.8}
          max={1.4}
          step={0.05}
          onChange={(v) => onUIScaleChange({ global: v })}
          displayValue={`${Math.round(uiScale.global * 100)}%`}
        />

        {(
          [
            ["text", "settings.scale_text"],
            ["avatar", "settings.scale_avatar"],
            ["window", "settings.scale_window"],
            ["density", "settings.scale_density"],
          ] as const
        ).map(([key, labelKey]) => (
          <div key={key} className="flex flex-col gap-1 pl-2 border-l border-border/30">
            <SliderField
              label={t(labelKey)}
              value={uiScale[key]}
              min={0.8}
              max={1.4}
              step={0.05}
              onChange={(v) => onUIScaleChange({ [key]: v })}
              displayValue={uiScale[key] !== 1 ? `\u00D7${uiScale[key].toFixed(2)}` : "1\u00D7"}
            />
          </div>
        ))}
      </div>

      <ToggleField
        label={t("settings.canvas_auto_expand")}
        checked={canvasAutoExpand}
        onChange={onCanvasAutoExpandChange}
      />
    </div>
  );
}