import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import type { StatusEvent, SettingsEvent } from "../../lib/protocol";
import { SectionHeader } from "./SectionHeader";
import { SettingsCard } from "./SettingsCard";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Partial<SettingsEvent>) => void;
}

const MIN_TOKENS = 4096;
const MAX_TOKENS = 131072;
const STEP = 2048;

function clampTokens(v: number): number {
  if (!Number.isFinite(v)) return MIN_TOKENS;
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, Math.floor(Math.abs(v))));
}

function formatTokens(v: number): string {
  if (v >= 1024) return `${(v / 1024).toFixed(0)}k`;
  return String(v);
}

export function GenerationSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(systemStatus?.llm_max_tokens ?? 16384);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from server (handles external changes).
  useEffect(() => {
    const sv = systemStatus?.llm_max_tokens;
    if (sv != null) setValue(sv);
  }, [systemStatus?.llm_max_tokens]);

  // Cleanup debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = useCallback((v: number) => {
    const next = clampTokens(v);
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate({ llm_max_tokens: next });
    }, 300);
  }, [onUpdate]);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Gauge}
        title={t("settings.generation.title")}
        description={t("settings.generation.description")}
      />

      <SettingsCard>
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-muted">{t("settings.max_tokens")}</span>
              <span className="text-[11px] text-muted/60">{t("settings.max_tokens_hint")}</span>
            </div>
            <span className="text-xs font-mono text-ai-signal bg-ai-signal/10 border border-ai-signal/30 rounded px-2 py-1">
              {formatTokens(value)}
            </span>
          </div>

          <div className="flex items-center gap-3">
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
              max={MAX_TOKENS}
              step={STEP}
              value={value}
              onChange={(e) => handleChange(Number(e.target.value))}
              className="w-24 bg-ai-panel border border-ai-rail rounded-lg px-2.5 py-2 text-sm font-mono text-ai-readout outline-none focus:border-ai-signal/60 transition-colors text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-muted/60">
            <span>{formatTokens(MIN_TOKENS)}</span>
            <span>{formatTokens(MAX_TOKENS)}</span>
          </div>
        </section>

        <p className="text-[10px] font-mono text-ai-label/60 italic">{t("ai.change_next_turn")}</p>
      </SettingsCard>
    </div>
  );
}
