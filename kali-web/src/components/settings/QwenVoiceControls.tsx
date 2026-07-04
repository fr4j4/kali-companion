import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatusEvent, VoiceDesignPreset, QwenVoice } from "../../lib/protocol";
import { VoiceDesignControls } from "./VoiceDesignControls";
import { VoicePreviewButton } from "./VoicePreviewButton";
import { useStage } from "../../stage/StageProvider";
import { Select } from "../ui/Select";

interface Props {
  systemStatus: StatusEvent | null;
  voices: Record<string, unknown>[];
  variant: string | null;
  onUpdate: (patch: Record<string, unknown>) => void;
}

export function QwenVoiceControls({ systemStatus, voices, variant, onUpdate }: Props) {
  const { t } = useTranslation();
  const { customVoices, sttLanguage } = useStage();

  const currentVoice = systemStatus?.voice ?? "serena";

  const [instructions, setInstructions] = useState(t("voice.instructions_default"));
  const [seed, setSeed] = useState(-1);
  const [selectedPreset, setSelectedPreset] = useState("warm-female");

  const isVoiceDesign = variant === "voicedesign";
  const isCustomVoice = variant === "customvoice";
  const isNoModel = !variant;

  const qwenVoices = voices as unknown as QwenVoice[];
  const voiceDesignPresets = voices as unknown as VoiceDesignPreset[];

  const qwenVoiceIds = qwenVoices.map((v) => v.id);
  const effectiveVoice =
    qwenVoiceIds.length > 0 && !qwenVoiceIds.includes(currentVoice)
      ? "serena"
      : currentVoice;

  const refreshCustomVoices = () => {
    window.dispatchEvent(new CustomEvent("refresh-custom-voices"));
  };

  if (isNoModel) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-xs text-muted bg-surface-secondary rounded-md p-3">
          {t("settings.tts_qwen_no_model")}
        </div>
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
          ttsProvider="qwen3"
          onCustomVoicesChange={refreshCustomVoices}
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
            <Select
              value={effectiveVoice}
              onChange={(v) => onUpdate({ voice: v })}
              options={voices.length === 0
                ? [{ value: effectiveVoice, label: effectiveVoice }]
                : qwenVoices.map((v) => ({
                    value: v.id,
                    label: `${v.name} (${v.gender})`,
                  }))
              }
              className="flex-1"
            />
            <VoicePreviewButton voiceId={effectiveVoice} sttLanguage={sttLanguage} provider="qwen3" />
          </div>
        </div>
        <p className="text-[11px] text-muted/60">{t("voice.qwen3_language_auto")}</p>
      </div>
    );
  }

  return null;
}