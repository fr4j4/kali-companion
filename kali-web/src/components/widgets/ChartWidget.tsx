/**
 * ChartWidget — a small dashboard: headline figures, one chart and a breakdown.
 *
 * Data (all optional): `kpis: [{ label, value, note?, tone? }]`, `labels: string[]`,
 * `series: [{ name, values: number[] }]`, `kind: "line" | "bar"`, `target: { label, value }`,
 * `unit`, `breakdown: { title, items: [{ label, value }] }`, `source`, `updated`. The older shape
 * `data: [{ name, a: 1, b: 2 }]` still works (one series per numeric column). Without KPIs the
 * widget derives the total, the best point and the gap to the target from a single series.
 *
 * One y-axis, up to four series (the rest are left out and said so), direct label at the end of
 * each line, a dashed target line, crosshair and tooltip on hover, and a table view.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner, isStreaming as isStreamingContent } from "./base/StreamingSpinner";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { Table2, LineChart } from "lucide-react";

interface Props {
  content?: unknown;
}

export interface ChartSeries { name: string; values: number[] }
export interface ChartKpi { label: string; value: string; note?: string; tone?: "ok" | "err" | "warn" }
export interface ChartModel {
  title: string;
  unit: string;
  kind: "line" | "bar";
  labels: string[];
  series: ChartSeries[];
  dropped: number;
  target: { label: string; value: number } | null;
  kpis: ChartKpi[];
  breakdown: { title: string; items: { label: string; value: number }[] } | null;
  source: string;
  updated: string;
}

/** Categorical slots in fixed order (never cycled): identity follows the series' position. */
const SERIES_COLORS = ["var(--accent)", "var(--accent2)", "var(--ok)", "var(--fg)"];
const MAX_SERIES = SERIES_COLORS.length;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
export const fmtNum = (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 });

const SAMPLE = {
  title: "Ventas por mes",
  unit: "Miles de pesos",
  labels: ["Abr", "May", "Jun", "Jul", "Ago", "Sep"],
  series: [{ name: "Ventas", values: [720, 810, 790, 905, 880, 765] }],
  target: { label: "Meta", value: 800 },
  breakdown: { title: "Por servicio", items: [{ label: "Limpieza", value: 2140 }, { label: "Regulación", value: 1790 }, { label: "Cristales", value: 940 }] },
};

/** Normalise any accepted chart payload into one model. */
export function chartModel(d: Record<string, unknown>): ChartModel {
  let labels: string[] = Array.isArray(d.labels) ? (d.labels as unknown[]).map(str) : [];
  let series: ChartSeries[] = [];
  if (Array.isArray(d.series)) {
    series = (d.series as Record<string, unknown>[]).filter(Boolean).map((s, i) => {
      const raw = Array.isArray(s.values) ? s.values : Array.isArray(s.data) ? s.data : Array.isArray(s.points) ? s.points : [];
      const vals = (raw as unknown[]).map((p) => (p && typeof p === "object" ? num((p as Record<string, unknown>).y) : num(p)) ?? 0);
      if (!labels.length && Array.isArray(s.points)) labels = (s.points as Record<string, unknown>[]).map((p) => str(p?.x));
      return { name: str(s.name) || `#${i + 1}`, values: vals };
    });
  } else if (Array.isArray(d.data)) {
    const rows = (d.data as Record<string, unknown>[]).filter((r) => r && typeof r === "object");
    const labelKey = ["name", "label", "x", "date", "mes", "month"].find((k) => rows.some((r) => k in r)) ?? "";
    labels = rows.map((r, i) => (labelKey ? str(r[labelKey]) : String(i + 1)));
    const keys: string[] = [];
    for (const r of rows) for (const k of Object.keys(r)) if (k !== labelKey && !keys.includes(k) && num(r[k]) != null) keys.push(k);
    series = keys.map((k) => ({ name: k, values: rows.map((r) => num(r[k]) ?? 0) }));
  }
  const n = Math.max(labels.length, ...series.map((s) => s.values.length), 0);
  while (labels.length < n) labels.push(String(labels.length + 1));
  const dropped = Math.max(0, series.length - MAX_SERIES);
  series = series.slice(0, MAX_SERIES);

  const t = d.target as Record<string, unknown> | number | undefined;
  const target = typeof t === "number" ? { label: "", value: t } : t && num(t.value) != null ? { label: str(t.label), value: num(t.value)! } : null;

  const kpis: ChartKpi[] = Array.isArray(d.kpis)
    ? (d.kpis as Record<string, unknown>[]).filter(Boolean).slice(0, 4).map((k) => ({
        label: str(k.label), value: str(k.value), note: str(k.note) || undefined,
        tone: k.tone === "ok" || k.tone === "err" || k.tone === "warn" ? k.tone : undefined,
      }))
    : [];

  const b = d.breakdown as Record<string, unknown> | undefined;
  const breakdown = b && Array.isArray(b.items)
    ? { title: str(b.title), items: (b.items as Record<string, unknown>[]).filter(Boolean).map((i) => ({ label: str(i.label), value: num(i.value) ?? 0 })) }
    : null;

  return {
    title: str(d.title), unit: str(d.unit), kind: d.kind === "bar" ? "bar" : "line",
    labels, series, dropped, target, kpis, breakdown, source: str(d.source), updated: str(d.updated),
  };
}

/** Three round ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= max + step * 0.5 && out.length < 8; v += step) out.push(Number(v.toFixed(6)));
  if (out[out.length - 1] < max) out.push(Number((out[out.length - 1] + step).toFixed(6)));
  return out;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 480, h: 220 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function Plot({ m, showTarget }: { m: ChartModel; showTarget: boolean }) {
  const { t } = useTranslation();
  const [ref, { w, h }] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = m.series.flatMap((s) => s.values);
  if (showTarget && m.target) all.push(m.target.value);
  const ticks = niceTicks(Math.min(...all, m.kind === "bar" ? 0 : Infinity), Math.max(...all));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  // Room on the right for the axis values and the direct labels at the line ends.
  const endLabel = m.kind === "line" ? Math.min(120, Math.max(...m.series.map((s) => (s.name.length + 6) * 7), 0)) : 0;
  const pad = { l: 12, r: 44 + endLabel, t: 26, b: 24 };
  const iw = Math.max(40, w - pad.l - pad.r), ih = Math.max(40, h - pad.t - pad.b);
  const n = m.labels.length;
  const x = (i: number) => (m.kind === "bar" ? pad.l + (iw / n) * (i + 0.5) : pad.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1)));
  const y = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 48))));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0, dist = Infinity;
    for (let i = 0; i < n; i++) { const dd = Math.abs(x(i) - px); if (dd < dist) { dist = dd; best = i; } }
    setHover(best);
  };

  const single = m.series.length === 1 ? m.series[0] : null;
  const peak = single ? single.values.indexOf(Math.max(...single.values)) : -1;
  const barW = Math.max(4, Math.min(36, (iw / n - 2) / Math.max(1, m.series.length)));

  return (
    <div ref={ref} className="kw-plot">
      <svg width={w} height={h} role="img" aria-label={m.title || (t("v2.type.chart") as string)} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="kw-grid-line" x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} />
            <text className="kw-axis" x={pad.l + iw + 8} y={y(v) + 4}>{fmtNum(v)}</text>
          </g>
        ))}
        {m.labels.map((l, i) => (i % labelEvery === 0 || i === n - 1 ? (
          <text key={i} className="kw-axis" x={x(i)} y={h - 6} textAnchor="middle">{l}</text>
        ) : null))}
        {showTarget && m.target && (
          <g>
            <line className="kw-target" x1={pad.l} x2={pad.l + iw} y1={y(m.target.value)} y2={y(m.target.value)} />
            <text className="kw-target-label" x={pad.l + iw - 2} y={y(m.target.value) - 6} textAnchor="end">{m.target.label || t("v2.chart.target")}</text>
          </g>
        )}
        {hover != null && <line className="kw-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />}
        {m.kind === "bar"
          ? m.series.map((s, si) => s.values.map((v, i) => {
              const bx = x(i) - (barW * m.series.length + 2 * (m.series.length - 1)) / 2 + si * (barW + 2);
              const top = y(Math.max(v, 0)), base = y(Math.max(yMin, 0));
              const bh = Math.max(1, Math.abs(base - top));
              const r = Math.min(4, barW / 2, bh);
              return (
                <path
                  key={`${si}-${i}`}
                  d={`M${bx},${base} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${base} Z`}
                  fill={SERIES_COLORS[si]}
                  opacity={hover == null || hover === i ? 1 : 0.55}
                />
              );
            }))
          : m.series.map((s, si) => {
              const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
              const li = s.values.length - 1;
              return (
                <g key={si}>
                  <path d={d} fill="none" stroke={SERIES_COLORS[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {li >= 0 && <circle cx={x(li)} cy={y(s.values[li])} r={4.5} fill={SERIES_COLORS[si]} stroke="var(--bg-elev)" strokeWidth={2} />}
                  {li >= 0 && <text className="kw-end-label" x={x(li) + 9} y={y(s.values[li]) + 4}>{s.name} {fmtNum(s.values[li])}</text>}
                  {hover != null && s.values[hover] != null && <circle cx={x(hover)} cy={y(s.values[hover])} r={4} fill="var(--bg-elev)" stroke={SERIES_COLORS[si]} strokeWidth={2} />}
                </g>
              );
            })}
        {single && m.kind === "line" && peak >= 0 && peak !== single.values.length - 1 && (
          <g>
            <circle cx={x(peak)} cy={y(single.values[peak])} r={5} fill="var(--bg-elev)" stroke={SERIES_COLORS[0]} strokeWidth={2} />
            <text className="kw-peak-label" x={x(peak)} y={y(single.values[peak]) - 10} textAnchor="middle">{fmtNum(single.values[peak])}</text>
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="kw-tooltip" style={{ left: Math.min(Math.max(x(hover) + 12, 0), Math.max(0, w - 170)), top: pad.t }}>
          <div className="kw-tooltip-title">{m.labels[hover]}</div>
          {m.series.map((s, si) => (
            <div key={si} className="kw-tooltip-row">
              <span className="kw-swatch" style={{ background: SERIES_COLORS[si] }} />{s.name}<span className="kw-mono">{fmtNum(s.values[hover] ?? 0)}</span>
            </div>
          ))}
          {showTarget && m.target && <div className="kw-tooltip-row is-dim">{m.target.label || t("v2.chart.target")}<span className="kw-mono">{fmtNum(m.target.value)}</span></div>}
        </div>
      )}
    </div>
  );
}

export function ChartWidget({ content }: Props) {
  const { t } = useTranslation();
  const { compact } = useShell();
  const { data, isReal, title } = useMemo(() => parseContent(content), [content]);
  const raw = (data && typeof data === "object" && !Array.isArray(data) ? data : Array.isArray(data) ? { data } : {}) as Record<string, unknown>;
  const hasData = Array.isArray(raw.series) || Array.isArray(raw.data);
  const sample = !isReal || !hasData;
  const m = useMemo(() => chartModel(hasData ? raw : SAMPLE), [raw, hasData]);
  const [showTarget, setShowTarget] = useState(true);
  const [asTable, setAsTable] = useState(false);

  // Headline figures: the ones Kali sent, else derived from a single series.
  const kpis = useMemo<ChartKpi[]>(() => {
    if (m.kpis.length) return m.kpis;
    const s = m.series.length === 1 ? m.series[0] : null;
    if (!s || !s.values.length) return [];
    const total = s.values.reduce((a, b) => a + b, 0);
    const bi = s.values.indexOf(Math.max(...s.values));
    const out: ChartKpi[] = [{ label: t("v2.chart.total"), value: fmtNum(total), note: m.unit || undefined }];
    if (m.target) {
      const goal = m.target.value * s.values.length;
      const pct = goal ? ((total - goal) / goal) * 100 : 0;
      out.push({
        label: t("v2.chart.vs_target"),
        value: `${pct >= 0 ? "+" : ""}${pct.toLocaleString(i18n.language, { maximumFractionDigits: 1 })} %`,
        note: t(total >= goal ? "v2.chart.over" : "v2.chart.under", { diff: fmtNum(Math.abs(total - goal)), target: fmtNum(goal) }),
        tone: pct >= 0 ? "ok" : "err",
      });
    }
    out.push({ label: t("v2.chart.best"), value: m.labels[bi] ?? "", note: fmtNum(s.values[bi]) });
    return out;
  }, [m, t]);

  useShellSubtitle(m.unit || m.title || null);
  useShellSample(sample);

  const maxB = m.breakdown ? Math.max(...m.breakdown.items.map((i) => i.value), 1) : 1;

  return (
    <BaseWidget>
      <WidgetToolbar>
        <button
          type="button"
          className="tooltip w-6 h-6 rounded hover:bg-fg/10 text-muted hover:text-accent transition flex items-center justify-center"
          data-tip={asTable ? t("v2.chart.as_chart") : t("v2.chart.as_table")}
          aria-label={(asTable ? t("v2.chart.as_chart") : t("v2.chart.as_table")) as string}
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? <LineChart size={14} /> : <Table2 size={14} />}
        </button>
      </WidgetToolbar>
      {isStreamingContent(content) ? (
        <StreamingSpinner content={content} windowType="chart" />
      ) : (
        <div className="kw-dash scrollbar-thin">
          {m.target && !compact && (
            <div className="kw-dash-filters">
              <label className="kw-switch">
                {t("v2.chart.compare_target")}
                <input type="checkbox" role="switch" checked={showTarget} onChange={(e) => setShowTarget(e.target.checked)} />
                <span aria-hidden="true" />
              </label>
            </div>
          )}
          {kpis.length > 0 && !compact && (
            <div className="kw-kpis">
              {kpis.map((k, i) => (
                <div key={i} className="kw-kpi">
                  <div className="kw-kpi-label">{k.label}</div>
                  <div className={`kw-kpi-value ${k.tone ? `is-${k.tone}` : ""}`}>{k.value}</div>
                  {k.note && <div className="kw-kpi-note">{k.note}</div>}
                </div>
              ))}
            </div>
          )}
          <div className={`kw-dash-row ${m.breakdown && !compact ? "has-side" : ""}`}>
            <section className="kw-card kw-chart-card">
              <header>
                <h3>{m.title || title || t("v2.type.chart")}</h3>
                {m.unit && <p>{m.unit}</p>}
                {m.series.length > 1 && (
                  <div className="kw-legend">
                    {m.series.map((s, si) => <span key={si}><span className="kw-swatch" style={{ background: SERIES_COLORS[si] }} />{s.name}</span>)}
                  </div>
                )}
              </header>
              {asTable ? (
                <div className="kw-chart-table scrollbar-thin">
                  <table>
                    <thead><tr><th /> {m.series.map((s, si) => <th key={si} className="is-num">{s.name}</th>)}</tr></thead>
                    <tbody>
                      {m.labels.map((l, i) => (
                        <tr key={i}><th scope="row">{l}</th>{m.series.map((s, si) => <td key={si} className="is-num">{fmtNum(s.values[i] ?? 0)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : m.labels.length ? (
                <Plot m={m} showTarget={showTarget} />
              ) : (
                <p className="kw-empty">{t("v2.chart.no_data")}</p>
              )}
              {m.dropped > 0 && <p className="kw-chart-note">{t("v2.chart.dropped", { count: m.dropped })}</p>}
            </section>
            {m.breakdown && !compact && (
              <section className="kw-card kw-breakdown">
                <header><h3>{m.breakdown.title || t("v2.chart.breakdown")}</h3></header>
                {m.breakdown.items.map((it, i) => (
                  <div key={i} className="kw-break-row">
                    <div className="kw-break-head"><span>{it.label}</span><span className="kw-mono">{fmtNum(it.value)}</span></div>
                    <div className="kw-break-track"><div style={{ width: `${(it.value / maxB) * 100}%` }} /></div>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>
      )}
      <WidgetFooter>
        {m.source && <span className="v2-foot-item">{t("v2.chart.source", { source: m.source })}</span>}
        {m.updated && <span className="v2-foot-item">{t("v2.chart.updated", { when: m.updated })}</span>}
        {!m.source && !m.updated && <span className="v2-foot-item">{t("v2.chart.points", { count: m.labels.length })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
