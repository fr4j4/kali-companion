// BehaviorSection — input mode, wake word, feedback mode, plan mode, profile.

import { useTranslation } from "react-i18next";
import type { StatusEvent } from "../../lib/protocol";
import { SelectField, ToggleField } from "./fields";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
}

const INPUT_MODES = [
  { id: "ptt", labelKey: "input_mode.ptt" },
  { id: "wake_word", labelKey: "input_mode.wake_word" },
  { id: "continuous", labelKey: "input_mode.continuous" },
];

const FEEDBACK_MODES = [
  { id: "minimal", labelKey: "settings.feedback_minimal" },
  { id: "confirm", labelKey: "settings.feedback_confirm" },
  { id: "plan", labelKey: "settings.feedback_plan" },
];

export function BehaviorSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();

  const profile = systemStatus?.profile ?? "dev";
  const profiles = systemStatus?.available_profiles ?? ["dev", "general", "files", "gaming"];
  const inputMode = (systemStatus as { input_mode?: string })?.input_mode ?? "wake_word";
  const wakeWordEnabled = systemStatus?.wake_word_enabled ?? false;
  const feedbackMode = (systemStatus as { feedback_mode?: string })?.feedback_mode ?? "minimal";
  const planMode = (systemStatus as { plan_mode?: boolean })?.plan_mode ?? false;
  const artifactDiffPreview = systemStatus?.artifact_diff_preview ?? true;

  const handleInputModeChange = (mode: string) => {
    if (mode === "wake_word") {
      onUpdate({ input_mode: mode, wake_word_enabled: true });
    } else {
      onUpdate({ input_mode: mode, wake_word_enabled: false });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label={t("settings.input_mode")}
        value={inputMode}
        onChange={handleInputModeChange}
      >
        {INPUT_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {t(m.labelKey)}
          </option>
        ))}
      </SelectField>

      {inputMode === "wake_word" && (
        <ToggleField
          label={t("settings.wake_word")}
          checked={wakeWordEnabled}
          onChange={(v) => onUpdate({ wake_word_enabled: v })}
        />
      )}

      <SelectField
        label={t("settings.feedback_mode")}
        value={feedbackMode}
        onChange={(v) => onUpdate({ feedback_mode: v })}
      >
        {FEEDBACK_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {t(m.labelKey)}
          </option>
        ))}
      </SelectField>

      {feedbackMode === "plan" && (
        <ToggleField
          label={t("settings.plan_mode")}
          checked={planMode}
          onChange={(v) => onUpdate({ plan_mode: v })}
        />
      )}

      <SelectField
        label={t("settings.profile")}
        value={profile}
        onChange={(v) => onUpdate({ profile: v })}
      >
        {profiles.map((p) => (
          <option key={p} value={p}>
            {t(`profile.${p}`)}
          </option>
        ))}
      </SelectField>

      <ToggleField
        label={t("settings.artifact_diff_preview")}
        checked={artifactDiffPreview}
        onChange={(v) => onUpdate({ artifact_diff_preview: v })}
      />
    </div>
  );
}