/**
 * ControlsWidget — a small panel of settings: labelled sliders with their value in mono, switches
 * and a choice, grouped in one card with the action at the end.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { Select } from "../ui/Select";
import { useShellSample } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="kw-field">
      <span className="kw-field-head"><span>{label}</span><span className="kw-mono">{format(value)}</span></span>
      <input type="range" className="kw-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--kw-fill" as string]: `${((value - min) / (max - min)) * 100}%` }} />
    </label>
  );
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

  useShellSample(true);

  return (
    <BaseWidget>
      <div className="kw-controls scrollbar-thin">
        <Slider label={t("widget.controls.temperature")} value={temp} min={0} max={2} step={0.1} format={(v) => v.toFixed(1)} onChange={setTemp} />
        <Slider label={t("widget.controls.max_tokens")} value={tokens} min={128} max={4096} step={128} format={(v) => String(v)} onChange={setTokens} />
        <label className="kw-switch is-row">
          {t("widget.controls.stream")}
          <input type="checkbox" role="switch" checked={stream} onChange={(e) => setStream(e.target.checked)} />
          <span aria-hidden="true" />
        </label>
        <div className="kw-field">
          <span className="kw-field-head"><span>{t("widget.controls.voice")}</span></span>
          <Select
            value={voice}
            onChange={(v) => setVoice(v)}
            options={[
              { value: "nova", label: t("widget.controls.voice_nova") },
              { value: "alloy", label: t("widget.controls.voice_alloy") },
              { value: "echo", label: t("widget.controls.voice_echo") },
              { value: "fable", label: t("widget.controls.voice_fable") },
            ]}
            buttonClassName="bg-fg/[0.04] border-fg/10 rounded-lg px-2.5 py-2 text-sm text-fg focus:border-accent/40"
          />
        </div>
        <button type="button" onClick={apply} className="v2-btn is-primary w-full">{t("widget.controls.apply")}</button>
      </div>
    </BaseWidget>
  );
}
