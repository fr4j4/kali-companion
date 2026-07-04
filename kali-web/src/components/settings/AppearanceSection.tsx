// AppearanceSection — theme, UI scale, canvas auto-expand, language.

import { useTranslation } from "react-i18next";
import { Palette, RotateCcw } from "lucide-react";
import { SelectField, SliderField, ToggleField } from "./fields";
import { SectionHeader } from "./SectionHeader";
import { SettingsCard } from "./SettingsCard";
import type { PerformanceProfile } from "../../App";

interface Props {
  theme: string;
  onThemeChange: (t: string) => void;
  performanceProfile: PerformanceProfile;
  onPerformanceProfileChange: (p: PerformanceProfile) => void;
  canvasAutoExpand: boolean;
  onCanvasAutoExpandChange: (v: boolean) => void;
  uiScale: { global: number; text: number; avatar: number; window: number; density: number };
  onUIScaleChange: (patch: Record<string, number>) => void;
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;
}

const THEMES = ["amberwave", "foxglove", "vellum", "tidepool", "aether"];
const PERFORMANCE_PROFILES: PerformanceProfile[] = ["balanced", "performance", "quality"];

const THEME_SWATCHES: Record<string, string[]> = {
  amberwave: ["#E8A24C", "#100E14", "#F2EBE0", "#7DD692"],
  foxglove: ["#C77DFF", "#1A1620", "#EDE7F0", "#8FD694"],
  vellum: ["#C24A2D", "#1F1B17", "#EFE6D3", "#8FAE6B"],
  tidepool: ["#E88AA8", "#0E1714", "#E4EDE8", "#6FBF8B"],
  aether: ["#6C6FF7", "#0A0C14", "#EDEDEF", "#34D399"],
};
const LANGS = [
  { id: "en", labelKey: "language.en" },
  { id: "es", labelKey: "language.es" },
];

export function AppearanceSection({
  theme,
  onThemeChange,
  performanceProfile,
  onPerformanceProfileChange,
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
      <SectionHeader
        icon={Palette}
        title={t("settings.section.appearance")}
        description={t("settings.appearance.description")}
      />

      <SettingsCard title={t("settings.appearance.theme_group")}>
        <div className="grid grid-cols-5 gap-2">
          {THEMES.map((tname) => {
            const swatches = THEME_SWATCHES[tname] || [];
            return (
              <button
                key={tname}
                onClick={() => onThemeChange(tname)}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${
                  theme === tname
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-accent/30 bg-elevated"
                }`}
                title={t(`theme.${tname}`)}
              >
                <div className="flex gap-0.5">
                  {swatches.map((c, i) => (
                    <span
                      key={i}
                      className="w-3 h-3 rounded-full border border-white/10"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-muted truncate w-full text-center">
                  {t(`theme.${tname}`)}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title={t("settings.appearance.language_group")}>
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
      </SettingsCard>

      <SettingsCard title={t("settings.appearance.performance_group")}>
        <SelectField
          label={t("settings.performance_profile")}
          value={performanceProfile}
          onChange={(value) => onPerformanceProfileChange(value as PerformanceProfile)}
          helperText={t("settings.performance_profile_hint")}
        >
          {PERFORMANCE_PROFILES.map((profile) => (
            <option key={profile} value={profile}>
              {t(`performance_profile.${profile}`)}
            </option>
          ))}
        </SelectField>
      </SettingsCard>

      <SettingsCard title={t("settings.appearance.scale_group")}>
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

        <button
          type="button"
          onClick={() => onUIScaleChange({ global: 1, text: 1, avatar: 1, window: 1, density: 1 })}
          className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted hover:text-foreground hover:bg-surface border border-border transition-colors self-start"
        >
          <RotateCcw size={12} />
          {t("settings.reset_scale")}
        </button>
      </SettingsCard>

      <SettingsCard title={t("settings.appearance.canvas_group")}>
        <ToggleField
          label={t("settings.canvas_auto_expand")}
          checked={canvasAutoExpand}
          onChange={onCanvasAutoExpandChange}
        />
      </SettingsCard>
    </div>
  );
}
