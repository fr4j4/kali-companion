/**
 * SourcesWidget — what Kali read to answer a question, and how the sources line up.
 *
 * The question on top; the sources on the left, each with the claim it makes as a chip; on the
 * right Kali's cross-check: a short synthesis, one bar per claim ("3 de 5"), the conflict when
 * there is one, and two answers back to Kali (use the answer, keep it in memory). The content is
 * `{ question, sources: [{ title, site, year?, claim, url? }], synthesis, conflict?, answer? }`.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellStatus, useShellSubtitle } from "../../stage/v2/shell";
import { useStage } from "../../stage/StageProvider";

export interface Source { title: string; site?: string; year?: string | number; claim?: string; url?: string }
export interface SourcesData { question: string; sources: Source[]; synthesis?: string; conflict?: string; answer?: string }

const SAMPLE: SourcesData = {
  question: "¿Cada cuánto conviene revisar un reloj mecánico?",
  sources: [
    { title: "Guía del relojero", site: "relojeria-ejemplo.cl", year: 2025, claim: "Cada 5 años" },
    { title: "Manual del fabricante", site: "manual-ejemplo.com", year: 2023, claim: "Cada 5 años" },
    { title: "Blog de coleccionistas", site: "coleccion-ejemplo.net", year: 2024, claim: "Cada 5 años" },
    { title: "Foro de aficionados", site: "foro-ejemplo.org", year: 2021, claim: "Cada 3 años" },
    { title: "Tienda de relojes", site: "tienda-ejemplo.cl", year: 2022, claim: "Cada 3 años" },
  ],
  synthesis: "Tres de cinco fuentes dicen cinco años, incluida la del fabricante. Las otras dos dicen tres y son más antiguas o comerciales.",
  conflict: "Se contradicen en el intervalo. Coinciden en que atrasarse más de un minuto por día es señal para revisar antes.",
  answer: "cinco años",
};

export interface ClaimGroup { claim: string; count: number; tone: number }

/** Claims the sources make, most supported first; `tone` is the colour slot (0 accent, 1 accent2, 2 neutral). */
export function claimGroups(sources: Source[]): ClaimGroup[] {
  const counts = new Map<string, number>();
  for (const s of sources) {
    const c = (s.claim ?? "").trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([claim, count], i) => ({ claim, count, tone: Math.min(i, 2) }));
}

function readData(data: unknown): SourcesData | null {
  const d = (data && typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (!d || !Array.isArray(d.sources)) return null;
  const sources = (d.sources as unknown[]).filter((s): s is Source => !!s && typeof s === "object" && typeof (s as Source).title === "string");
  return {
    question: typeof d.question === "string" ? d.question : "",
    sources,
    synthesis: typeof d.synthesis === "string" ? d.synthesis : "",
    conflict: typeof d.conflict === "string" ? d.conflict : "",
    answer: typeof d.answer === "string" ? d.answer : "",
  };
}

export function SourcesWidget({ content }: { content?: unknown }) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const real = useMemo(() => (isReal ? readData(data) : null), [data, isReal]);
  const d = real ?? SAMPLE;
  const groups = useMemo(() => claimGroups(d.sources), [d.sources]);
  const toneOf = (claim?: string) => groups.find((g) => g.claim === (claim ?? "").trim())?.tone ?? 2;
  const disagree = groups.length > 1 ? d.sources.length - groups[0].count : 0;
  const answer = d.answer || groups[0]?.claim || "";
  const [sel, setSel] = useState(0);
  const [sent, setSent] = useState<"use" | "remember" | null>(null);

  useShellSubtitle(t("v2.sources.subtitle"));
  useShellSample(!real);
  useShellStatus(groups.length ? { kind: "done", label: t("v2.sources.ready") as string } : null);

  const use = () => { chat.send(t("v2.sources.use_msg", { answer, question: d.question })); setSent("use"); };
  const remember = () => { chat.send(t("v2.sources.remember_msg", { answer, question: d.question })); setSent("remember"); };

  const synthesis = (
    <section className="kw-src-cross" aria-label={t("v2.sources.cross") as string}>
      <h3 className="kw-side-title is-inline is-accent">{t("v2.sources.cross")}</h3>
      {d.synthesis && <p className="kw-src-synth">{d.synthesis}</p>}
      {groups.length > 0 && (
        <div className="kw-src-tally">
          {groups.slice(0, 4).map((g) => (
            <div key={g.claim}>
              <div className="kw-src-tally-row"><span>{g.claim}</span><span className="kw-mono">{t("v2.sources.n_of", { n: g.count, total: d.sources.length })}</span></div>
              <div className={`kw-break-track is-tone-${g.tone}`} role="img" aria-label={`${g.claim}: ${t("v2.sources.n_of", { n: g.count, total: d.sources.length })}`}>
                <div style={{ width: `${(g.count / Math.max(1, d.sources.length)) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {d.conflict && (
        <div className="kw-callout is-warn"><AlertTriangle size={14} aria-hidden="true" /><span>{d.conflict}</span></div>
      )}
      {!compact && isReal && answer && (
        <div className="kw-src-actions">
          {sent ? (
            <span className="kw-review-done is-ok">{t(sent === "use" ? "v2.sources.used" : "v2.sources.remembered")}</span>
          ) : (
            <>
              <button type="button" className="v2-btn is-primary" onClick={use}>{t("v2.sources.use", { answer })}</button>
              <button type="button" className="v2-btn" onClick={remember}>{t("v2.sources.remember")}</button>
            </>
          )}
        </div>
      )}
    </section>
  );

  return (
    <BaseWidget>
      <div className="kw-src">
        {d.question && (
          <header className="kw-src-q">
            <span className="kw-side-title is-inline">{t("v2.sources.question")}</span>
            <h2>{d.question}</h2>
          </header>
        )}
        {compact ? (
          <div className="kw-src-body is-compact scrollbar-thin">{synthesis}</div>
        ) : (
          <div className="kw-src-body">
            <ul className="kw-src-list scrollbar-thin" aria-label={t("v2.sources.list") as string}>
              {d.sources.map((s, i) => (
                <li key={i}>
                  <div
                    role="button"
                    tabIndex={0}
                    className="kw-src-card"
                    aria-pressed={i === sel}
                    onClick={() => setSel(i)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(i); } }}
                  >
                    <div className="kw-src-card-top">
                      <strong>{s.title}</strong>
                      {s.claim && <span className={`kw-src-chip is-tone-${toneOf(s.claim)}`}>{s.claim}</span>}
                    </div>
                    <div className="kw-src-site kw-mono">{[s.site, s.year].filter(Boolean).join(" · ")}</div>
                    {i === sel && s.url && (
                      <a className="kw-src-open" href={s.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={12} aria-hidden="true" />{t("v2.sources.open")}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="kw-src-side scrollbar-thin">{synthesis}</div>
          </div>
        )}
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{t("v2.sources.count", { count: d.sources.length })}</span>
        {disagree > 0 && <span className="v2-foot-item">{t("v2.sources.disagree", { count: disagree })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
