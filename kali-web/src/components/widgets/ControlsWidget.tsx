import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { Select } from "../ui/Select";

interface Props {
  content?: unknown;
}

export function ControlsWidget(_props: Props) {
  const { t } = useTranslation();
  const [temp, setTemp] = useState(0.7);
  const [tokens, setTokens] = useState(1024);
  const [stream, setStream] = useState(true);
  const [voice, setVoice] = useState("nova");

  const apply = useCallback(() => {
    // No interactive actions in this phase
  }, []);

  return (
    <BaseWidget>
      <div className="p-3 space-y-3">
        {/* Temperature slider */}
        <div>
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>{t("widget.controls.temperature")}</span>
            <span>{temp.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temp}
            onChange={(e) => setTemp(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
        </div>

        {/* Max tokens slider */}
        <div>
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>{t("widget.controls.max_tokens")}</span>
            <span>{tokens}</span>
          </div>
          <input
            type="range"
            min="128"
            max="4096"
            step="128"
            value={tokens}
            onChange={(e) => setTokens(parseInt(e.target.value))}
            className="w-full accent-accent"
          />
        </div>

        {/* Stream toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t("widget.controls.stream")}</span>
          <button
            onClick={() => setStream((s) => !s)}
            className={`w-9 h-5 rounded-full transition-colors relative ${stream ? "bg-accent" : "bg-white/10"}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${stream ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </div>

        {/* Voice select */}
        <div>
          <div className="text-xs text-muted mb-1">{t("widget.controls.voice")}</div>
          <Select
            value={voice}
            onChange={(v) => setVoice(v)}
            options={[
              { value: "nova", label: t("widget.controls.voice_nova") },
              { value: "alloy", label: t("widget.controls.voice_alloy") },
              { value: "echo", label: t("widget.controls.voice_echo") },
              { value: "fable", label: t("widget.controls.voice_fable") },
            ]}
            buttonClassName="bg-white/[0.04] border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-fg focus:border-accent/40"
          />
        </div>

        {/* Apply button */}
        <button onClick={apply} className="w-full py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:brightness-110 transition">
          {t("widget.controls.apply")}
        </button>
      </div>
    </BaseWidget>
  );
}
