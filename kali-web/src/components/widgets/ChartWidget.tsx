import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";

interface Props {
  content?: unknown;
}

export function ChartWidget({ content }: Props) {
  const { t } = useTranslation();
  const d = (content ?? {}) as Record<string, unknown>;
  const chartData = useMemo(() => {
    if (d.data && Array.isArray(d.data)) return d.data;
    if (Array.isArray(d)) return d;
    return [
      { name: "Mon", latency: 42, throughput: 230 },
      { name: "Tue", latency: 38, throughput: 280 },
      { name: "Wed", latency: 55, throughput: 210 },
      { name: "Thu", latency: 48, throughput: 260 },
      { name: "Fri", latency: 62, throughput: 190 },
      { name: "Sat", latency: 35, throughput: 310 },
      { name: "Sun", latency: 30, throughput: 340 },
    ];
  }, [d]) as { name: string; latency: number; throughput: number }[];

  const [tooltip, setTooltip] = useState<{ name: string; val: number } | null>(null);
  const maxVal = Math.max(...chartData.map((r) => Math.max(r.latency, r.throughput)));

  return (
    <BaseWidget>
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="chart" />
      ) : (
        <div className="p-3">
          <div className="flex items-end gap-2 h-40 relative">
            <div className="flex flex-col justify-between h-full text-[10px] text-muted/60 pr-1 shrink-0">
              <span>{maxVal}</span>
              <span>{Math.round(maxVal / 2)}</span>
              <span>0</span>
            </div>
            <div className="flex-1 flex items-end gap-1 h-full">
              {chartData.map((item, i) => {
                const h1 = (item.latency / maxVal) * 100;
                const h2 = (item.throughput / maxVal) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col justify-end items-center gap-0.5 h-full">
                    <div
                      className="chart-bar w-full rounded-t-sm bg-accent/60"
                      style={{ height: `${h1}%`, minHeight: 2 }}
                      onPointerEnter={() => setTooltip({ name: item.name, val: item.latency })}
                      onPointerLeave={() => setTooltip(null)}
                    />
                    <div
                      className="chart-bar w-full rounded-t-sm bg-ok/60"
                      style={{ height: `${h2}%`, minHeight: 2 }}
                      onPointerEnter={() => setTooltip({ name: item.name, val: item.throughput })}
                      onPointerLeave={() => setTooltip(null)}
                    />
                    <span className="text-[9px] text-muted/60 mt-1 truncate w-full text-center">{item.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {tooltip && (
            <div className="chart-tooltip" style={{ position: "relative", marginTop: 8 }}>
              {tooltip.name}: {tooltip.val}
            </div>
          )}
          <div className="flex items-center gap-3 mt-3 text-[10px] text-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent/60" /> {t("widget.chart.latency")}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-ok/60" /> {t("widget.chart.throughput")}</span>
          </div>
        </div>
      )}
    </BaseWidget>
  );
}
