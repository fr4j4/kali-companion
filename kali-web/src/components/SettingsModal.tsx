// SettingsModal — voice, TTS mode, auto-TTS, model, language, STT, wake word, input mode.

import { useTranslation } from "react-i18next";
import type { StatusEvent } from "../lib/protocol";
import { Modal } from "./ui/Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  systemStatus: StatusEvent | null;
  voices: { id: string; name: string }[];
  onUpdate: (patch: Record<string, unknown>) => void;
  theme?: string;
  onThemeChange?: (t: string) => void;
  canvasAutoExpand?: boolean;
  onCanvasAutoExpandChange?: (v: boolean) => void;
}

const MODES = ["normal", "whisper", "robotic", "radio", "deep"];
const STT_LANGS = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];
const INPUT_MODES = [
  { id: "ptt", labelKey: "input_mode.ptt" },
  { id: "wake_word", labelKey: "input_mode.wake_word" },
  { id: "continuous", labelKey: "input_mode.continuous" },
];
const THEMES = ["synthwave", "midnight", "sunset", "forest"];

export function SettingsModal({
  open,
  onClose,
  systemStatus,
  voices,
  onUpdate,
  theme = "midnight",
  onThemeChange,
  canvasAutoExpand = true,
  onCanvasAutoExpandChange,
}: Props) {
  const { t } = useTranslation();
  if (!open) return null;

  const profile = systemStatus?.profile ?? "dev";
  const currentVoice = systemStatus?.voice ?? "glados-es";
  const currentMode = systemStatus?.tts_mode ?? "normal";
  const profiles = systemStatus?.available_profiles ?? ["dev", "general", "files", "gaming"];
  const autoTts = systemStatus?.auto_tts ?? true;
  const model = systemStatus?.llm_model ?? "";
  const sttLanguage = systemStatus?.stt_language ?? "es";
  const inputMode = (systemStatus as { input_mode?: string })?.input_mode ?? "wake_word";
  const wakeWordEnabled = systemStatus?.wake_word_enabled ?? false;

  const handleInputModeChange = (mode: string) => {
    if (mode === "wake_word") {
      onUpdate({ input_mode: mode, wake_word_enabled: true });
    } else {
      onUpdate({ input_mode: mode, wake_word_enabled: false });
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("settings.title")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.input_mode")}</label>
          <select
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 font-inherit text-sm outline-none focus:border-accent-dim"
            value={inputMode}
            onChange={(e) => handleInputModeChange(e.target.value)}
          >
            {INPUT_MODES.map((m) => (
              <option key={m.id} value={m.id}>{t(m.labelKey)}</option>
            ))}
          </select>
        </div>
        {inputMode === "wake_word" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">
              <input
                type="checkbox"
                checked={wakeWordEnabled}
                onChange={(e) => onUpdate({ wake_word_enabled: e.target.checked })}
              />{" "}
              {t("settings.wake_word")}
            </label>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.profile")}</label>
          <select
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 font-inherit text-sm outline-none focus:border-accent-dim"
            value={profile}
            onChange={(e) => onUpdate({ profile: e.target.value })}
          >
            {profiles.map((p) => (
              <option key={p} value={p}>{t(`profile.${p}`)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.voice")}</label>
          <select
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 font-inherit text-sm outline-none focus:border-accent-dim"
            value={currentVoice}
            onChange={(e) => onUpdate({ voice: e.target.value })}
          >
            {voices.length === 0 ? <option value={currentVoice}>{currentVoice}</option> : voices.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.tts_mode")}</label>
          <select
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 font-inherit text-sm outline-none focus:border-accent-dim"
            value={currentMode}
            onChange={(e) => onUpdate({ tts_mode: e.target.value })}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>{t(`voice.mode.${m}`)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">
            <input
              type="checkbox"
              checked={autoTts}
              onChange={(e) => onUpdate({ auto_tts: e.target.checked })}
            />{" "}
            {t("settings.tts_enabled")}
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.theme")}</label>
          <select
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 font-inherit text-sm outline-none focus:border-accent-dim"
            value={theme}
            onChange={(e) => onThemeChange?.(e.target.value)}
          >
            {THEMES.map((tname) => (
              <option key={tname} value={tname}>{t(`theme.${tname}`)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.llm_model")}</label>
          <input
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 font-inherit text-sm outline-none focus:border-accent-dim"
            value={model}
            onChange={(e) => onUpdate({ llm_model: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.stt_language")}</label>
          <select
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 font-inherit text-sm outline-none focus:border-accent-dim"
            value={sttLanguage}
            onChange={(e) => onUpdate({ stt_language: e.target.value })}
          >
            {STT_LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">
            <input
              type="checkbox"
              checked={canvasAutoExpand}
              onChange={(e) => onCanvasAutoExpandChange?.(e.target.checked)}
            />{" "}
            {t("settings.canvas_auto_expand")}
          </label>
        </div>
      </div>
    </Modal>
  );
}