// MicLevelMeter — live microphone level bar with threshold indicator.
//
// Reads micLevelRef via requestAnimationFrame (imperative DOM update) to
// avoid triggering React re-renders ~3 times per second. The threshold
// line and calibrating indicator use normal React state (low-frequency).

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  micLevelRef: React.RefObject<number>;
  threshold: number;
  calibrating: boolean;
}

export function MicLevelMeter({ micLevelRef, threshold, calibrating }: Props) {
  const { t } = useTranslation();
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      if (barRef.current) {
        const level = micLevelRef.current ?? 0;
        const pct = Math.min(level * 100, 100);
        barRef.current.style.width = `${pct}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [micLevelRef]);

  const thresholdPct = Math.min(threshold * 100, 100);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted">{t("settings.stt_vad_mic_level")}</label>
      <div className="relative h-3 rounded-full bg-black/40 overflow-hidden border border-fg/5">
        {/* Live level bar (updated imperatively via rAF) */}
        <div
          ref={barRef}
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: "0%" }}
        />
        {/* Threshold marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-fg/70 shadow-sm pointer-events-none"
          style={{ left: `${thresholdPct}%` }}
        />
      </div>
      {calibrating && (
        <p className="text-[10px] text-accent animate-pulse">
          {t("settings.stt_vad_calibrating_hint")}
        </p>
      )}
    </div>
  );
}