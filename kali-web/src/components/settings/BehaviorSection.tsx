// BehaviorSection — input mode, wake word, feedback mode, plan mode, profile.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sliders } from "lucide-react";
import type { StatusEvent } from "../../lib/protocol";
import { SelectField, SliderField, ToggleField, TextField } from "./fields";
import { MicLevelMeter } from "./MicLevelMeter";
import { useStage } from "../../stage/StageProvider";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
}

const INPUT_MODES = [
  { id: "ptt", labelKey: "input_mode.ptt" },
  { id: "continuous", labelKey: "input_mode.continuous" },
];

const FEEDBACK_MODES = [
  { id: "minimal", labelKey: "settings.feedback_minimal" },
  { id: "confirm", labelKey: "settings.feedback_confirm" },
  { id: "plan", labelKey: "settings.feedback_plan" },
];

export function BehaviorSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const { ptt } = useStage();

  const profile = systemStatus?.profile ?? "dev";
  const profiles = systemStatus?.available_profiles ?? ["dev", "general", "files", "gaming"];
  const inputMode = (systemStatus as { input_mode?: string })?.input_mode ?? "ptt";
  const wakeWordEnabled = systemStatus?.wake_word_enabled ?? false;
  const sttVadSilenceTimeout = systemStatus?.stt_vad_silence_timeout ?? 1.0;
  const sttVadAutoCalibrate = systemStatus?.stt_vad_auto_calibrate ?? true;
  const sttVadRmsThreshold = systemStatus?.stt_vad_rms_threshold ?? 0.015;
  const sttEnabled = systemStatus?.stt_enabled ?? false;
  const showVad = inputMode !== "continuous";
  const feedbackMode = (systemStatus as { feedback_mode?: string })?.feedback_mode ?? "minimal";
  const planMode = (systemStatus as { plan_mode?: boolean })?.plan_mode ?? false;
  const artifactDiffPreview = systemStatus?.artifact_diff_preview ?? true;
  const gameSessionPath = systemStatus?.game_session_path ?? "";

  // Local state + debounce for VAD sliders (avoids WS chatter on drag).
  const [localVadTimeout, setLocalVadTimeout] = useState(sttVadSilenceTimeout);
  const [localVadRms, setLocalVadRms] = useState(sttVadRmsThreshold);
  const vadTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const vadRmsRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocalVadTimeout(sttVadSilenceTimeout);
  }, [sttVadSilenceTimeout]);

  useEffect(() => {
    setLocalVadRms(sttVadRmsThreshold);
  }, [sttVadRmsThreshold]);

  useEffect(() => {
    return () => {
      clearTimeout(vadTimeoutRef.current);
      clearTimeout(vadRmsRef.current);
    };
  }, []);

  const handleVadTimeoutChange = (v: number) => {
    setLocalVadTimeout(v);
    clearTimeout(vadTimeoutRef.current);
    vadTimeoutRef.current = setTimeout(() => onUpdate({ stt_vad_silence_timeout: v }), 300);
  };

  const handleVadRmsChange = (v: number) => {
    setLocalVadRms(v);
    clearTimeout(vadRmsRef.current);
    vadRmsRef.current = setTimeout(() => onUpdate({ stt_vad_rms_threshold: v }), 300);
  };

  const handleInputModeChange = (mode: string) => {
    if (mode === "continuous") {
      onUpdate({ input_mode: mode, wake_word_enabled: false });
    } else {
      onUpdate({ input_mode: mode });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <Sliders size={15} className="text-accent" />
        <span className="text-sm font-semibold text-foreground">{t("settings.section.behavior")}</span>
      </div>

      <SelectField
        label={t("settings.input_mode")}
        value={inputMode}
        onChange={handleInputModeChange}
        disabled={!sttEnabled}
        helperText={!sttEnabled ? t("dock.mic_disabled") : undefined}
      >
        {INPUT_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {t(m.labelKey)}
          </option>
        ))}
      </SelectField>

      {inputMode === "ptt" && (
        <ToggleField
          label={t("settings.wake_word")}
          checked={wakeWordEnabled}
          onChange={(v) => onUpdate({ wake_word_enabled: v })}
          disabled={!sttEnabled}
        />
      )}

      {showVad && (
        <div className={`flex flex-col gap-3 pt-2 border-t border-border ${!sttEnabled ? "opacity-50 pointer-events-none" : ""}`}>
          <label className="text-xs text-muted font-semibold">{t("settings.stt_vad")}</label>

          <SliderField
            label={t("settings.stt_vad_silence_timeout")}
            value={localVadTimeout}
            min={0.5}
            max={3}
            step={0.1}
            onChange={handleVadTimeoutChange}
            displayValue={`${localVadTimeout.toFixed(1)}${t("common.seconds_abbrev")}`}
            disabled={!sttEnabled}
          />

          <ToggleField
            label={t("settings.stt_vad_auto_calibrate")}
            checked={sttVadAutoCalibrate}
            onChange={(v) => onUpdate({ stt_vad_auto_calibrate: v })}
            disabled={!sttEnabled}
          />

          <MicLevelMeter
            micLevelRef={ptt.micLevelRef}
            threshold={ptt.rmsThreshold}
            calibrating={ptt.calibrating}
          />

          {!sttVadAutoCalibrate && (
            <SliderField
              label={t("settings.stt_vad_sensitivity")}
              value={localVadRms}
              min={0.001}
              max={0.05}
              step={0.001}
              onChange={handleVadRmsChange}
              displayValue={localVadRms.toFixed(3)}
              disabled={!sttEnabled}
            />
          )}

          <button
            onClick={ptt.calibrate}
            disabled={ptt.calibrating || !sttEnabled}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
              (ptt.calibrating || !sttEnabled)
                ? "border-border opacity-50 cursor-not-allowed"
                : "border-accent/40 text-accent hover:bg-accent/10"
            }`}
          >
            {ptt.calibrating ? t("settings.stt_vad_calibrating") : t("settings.stt_vad_calibrate_now")}
          </button>

          <p className="text-[10px] text-muted/60">{t("settings.stt_vad_frontend_helper")}</p>
        </div>
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

      <TextField
        label={t("settings.game_session_path")}
        value={gameSessionPath}
        onChange={(v) => onUpdate({ game_session_path: v })}
        placeholder="~/.kali/game-sessions"
        helperText={t("settings.game_session_path_hint")}
      />
    </div>
  );
}