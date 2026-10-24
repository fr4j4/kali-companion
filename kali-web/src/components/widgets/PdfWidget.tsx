/**
 * PdfWidget — a PDF with the passages Kali marked.
 *
 * The page sits in the middle (the platform's own PDF viewer, opened at the page and zoom chosen
 * here), the pages on the left (marked ones carry a dot) and, on the right, "Marcado por Kali": each
 * mark with its page; choosing one turns to that page. The content is
 * `{ url | path, name?, pages?, size?, marks?: [{ page, text, note? }] }`; a path is served by the
 * core's file endpoint, like images.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Minus, Plus } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { imageUrlOf } from "./ImageWidget";

export interface PdfMark { page: number; text: string; note?: string }

const ZOOMS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200];
const MAX_RAIL = 200;

const SAMPLE_MARKS: PdfMark[] = [
  { page: 2, text: "Una gota por rubí, sin exceder la cavidad." },
  { page: 2, text: "No usar aceite denso en el escape." },
  { page: 5, text: "Intervalo de servicio: cinco años." },
];

/** Viewer URL at a page and zoom (the fragment Chromium's and Firefox's viewers read). */
export function pdfSrc(url: string, page: number, zoom: number): string {
  return `${url.split("#")[0]}#page=${page}&zoom=${zoom}`;
}

export function PdfWidget({ content }: { content?: unknown }) {
  const { t } = useTranslation();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const url = isReal ? imageUrlOf(data) : null;
  const name = (typeof d.name === "string" && d.name) || (typeof d.path === "string" ? d.path.split("/").pop() : "") || (url ? decodeURIComponent(url.split("/").pop()?.split(/[?#]/)[0] ?? "") : "");
  const marks = useMemo<PdfMark[]>(() => {
    if (!isReal) return SAMPLE_MARKS;
    if (!Array.isArray(d.marks)) return [];
    return (d.marks as PdfMark[]).filter((m) => m && Number.isFinite(m.page) && typeof m.text === "string").sort((a, b) => a.page - b.page);
  }, [d.marks, isReal]);
  const known = typeof d.pages === "number" && d.pages > 0 ? Math.floor(d.pages) : 0;
  const pages = known || (isReal ? Math.max(0, ...marks.map((m) => m.page)) : 8);
  const [page, setPage] = useState(() => marks[0]?.page ?? 1);
  const [zoom, setZoom] = useState(100);
  const [selMark, setSelMark] = useState(0);
  const markedPages = useMemo(() => new Set(marks.map((m) => m.page)), [marks]);

  useShellSubtitle(name || null);
  useShellSample(!isReal);

  const go = (p: number) => setPage(Math.max(1, known ? Math.min(known, p) : p));
  const zoomStep = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))]);
  };
  const labelOf = (p: number) => (known ? t("v2.pdf.page_of", { n: p, total: known }) : t("v2.pdf.page", { n: p })) as string;
  const pageLabel = labelOf(page);

  return (
    <BaseWidget>
      {url && (
        <WidgetToolbar>
          <a className="v2-icon-btn" href={url} target="_blank" rel="noreferrer noopener" aria-label={t("v2.pdf.open") as string} title={t("v2.pdf.open") as string}>
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        </WidgetToolbar>
      )}
      <div className="kw-pdf">
        {!compact && (
          <div className="kw-pdf-bar">
            <button type="button" className="v2-icon-btn sm" aria-label={t("v2.pdf.prev") as string} disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={15} aria-hidden="true" /></button>
            <span className="kw-mono">{known ? `${page} / ${known}` : page}</span>
            <button type="button" className="v2-icon-btn sm" aria-label={t("v2.pdf.next") as string} disabled={!!known && page >= known} onClick={() => go(page + 1)}><ChevronRight size={15} aria-hidden="true" /></button>
            <span className="kw-pdf-sep" aria-hidden="true" />
            <button type="button" className="v2-icon-btn sm" aria-label={t("v2.pdf.zoom_out") as string} disabled={zoom <= ZOOMS[0]} onClick={() => zoomStep(-1)}><Minus size={15} aria-hidden="true" /></button>
            <span className="kw-mono kw-pdf-zoom">{zoom} %</span>
            <button type="button" className="v2-icon-btn sm" aria-label={t("v2.pdf.zoom_in") as string} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => zoomStep(1)}><Plus size={15} aria-hidden="true" /></button>
          </div>
        )}
        <div className="kw-pdf-main">
          {!compact && pages > 1 && (
            <nav className="kw-pdf-rail scrollbar-thin" aria-label={t("v2.pdf.pages") as string}>
              {Array.from({ length: Math.min(pages, MAX_RAIL) }, (_, i) => i + 1).map((p) => (
                <button key={p} type="button" className="kw-pdf-thumb" aria-current={p === page || undefined} aria-label={labelOf(p)} onClick={() => go(p)}>
                  <span className="kw-pdf-sheet" aria-hidden="true"><i /><i /><i /><i />{markedPages.has(p) && <b />}</span>
                  <span className="kw-mono">{p}</span>
                </button>
              ))}
            </nav>
          )}
          <div className="kw-pdf-stage">
            {url ? (
              <iframe key={url} className="kw-pdf-frame" src={pdfSrc(url, page, zoom)} title={name || (t("v2.type.pdf") as string)} />
            ) : (
              <div className="kw-empty-state">
                <span className="kw-empty-icon"><FileText size={22} aria-hidden="true" /></span>
                <h3>{isReal ? t("v2.pdf.no_file") : t("v2.pdf.sample")}</h3>
                {!isReal && <p>{t("v2.pdf.sample_hint")}</p>}
              </div>
            )}
          </div>
          {!compact && marks.length > 0 && (
            <aside className="kw-pdf-marks scrollbar-thin" aria-label={t("v2.pdf.marked") as string}>
              <h3 className="kw-side-title is-inline">{t("v2.pdf.marked")}</h3>
              {marks.map((m, i) => (
                <button key={i} type="button" className="kw-pdf-mark" aria-pressed={i === selMark} onClick={() => { setSelMark(i); go(m.page); }}>
                  <span className="kw-mono">{t("v2.pdf.p", { n: m.page })}</span>
                  <span>{m.text}</span>
                  {m.note && <span className="kw-dim">{m.note}</span>}
                </button>
              ))}
            </aside>
          )}
        </div>
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{pageLabel}</span>
        {marks.length > 0 && <span className="v2-foot-item">{t("v2.pdf.marks", { count: marks.length })}</span>}
        {typeof d.size === "string" && <span className="v2-foot-item">{d.size}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
