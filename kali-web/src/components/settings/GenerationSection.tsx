// GenerationSection — LLM generation params (max response tokens).
//
// Separate from the model selector in ProviderSection: this governs *how*
// the model responds in the chat, not *which* model. Reasoning models
// (Ornith, DeepSeek-R1, Qwen3) spend part of this budget on chain-of-thought
// before producing the answer, so a higher ceiling is needed for complex
// artifacts than the legacy 16384 default.

import { useTranslation } from "react-i18next";
import type { StatusEvent, SettingsEvent } from "../../lib/protocol";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Partial<SettingsEvent>) => void;
}

const MIN_TOKENS = 4096;
const MAX_TOKENS = 131072;
const STEP = 2048;

function clampTokens(v: number): number {
  if (!Number.isFinite(v)) return MIN_TOKENS;
  return Math.max(MIN_TOKENS, Math.floor(Math.abs(v)));
}

function formatTokens(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(0)}k`;
  return String(v);
}

export function GenerationSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const value = systemStatus?.llm_max_tokens ?? 16384;

  const handleChange = (v: number) => {
    const next = clampTokens(v);
    if (next !== value) onUpdate({ llm_max_tokens: next });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Max response tokens ──────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-ai-label uppercase tracking-[0.15em]">
              {t("settings.max_tokens")}
            </span>
            <span className="text-[10px] font-mono text-ai-label/60 italic mt-0.5">
              {t("settings.max_tokens_hint")}
            </span>
          </div>
          <span className="text-xs font-mono text-ai-signal bg-ai-signal/10 border border-ai-signal/30 rounded px-2 py-1">
            {formatTokens(value)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="range"
            min={MIN_TOKENS}
            max={MAX_TOKENS}
            step={STEP}
            value={value}
            onChange={(e) => handleChange(parseInt(e.target.value, 10))}
            className="flex-1 accent-ai-signal"
          />
          <input
            type="number"
            min={MIN_TOKENS}
            step={STEP}
            value={value}
            onChange={(e) => handleChange(Number(e.target.value))}
            className="w-24 bg-ai-panel border border-ai-rail rounded-lg px-2.5 py-2 text-sm font-mono text-ai-readout outline-none focus:border-ai-signal/60 transition-colors text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-ai-label/50">
          <span>{formatTokens(MIN_TOKENS)}</span>
          <span>{formatTokens(MAX_TOKENS)}</span>
        </div>
      </section>

      <p className="text-[10px] font-mono text-ai-label/60 italic">{t("ai.change_next_turn")}</p>
    </div>
  );
}