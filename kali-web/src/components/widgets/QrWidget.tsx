/**
 * QrWidget — a real, scannable QR code (lib/qr.ts) for a link or a text.
 *
 * Dark modules on a white tile with the quiet zone the standard asks for, so a phone reads it in
 * either theme. The text can be edited; copy and download (SVG) live in the window header, and
 * the footer says the version, the error correction and the length.
 */

import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { encodeQr, type Ecc, type QrCode } from "../../lib/qr";

interface Props {
  content?: unknown;
}

const QUIET = 4;

/** SVG markup of a QR code: one path for every dark module. */
export function qrSvg(qr: QrCode, scale = 8): string {
  const n = qr.size + QUIET * 2;
  let d = "";
  qr.modules.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + QUIET},${y + QUIET}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export function QrWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const given = typeof data === "string" ? data : (d.text as string) || (d.url as string) || (d.data as string) || "";
  const ecc: Ecc = d.ecc === "L" || d.ecc === "Q" || d.ecc === "H" ? d.ecc : "M";
  const [text, setText] = useState(given || "https://example.com");
  useEffect(() => { if (given) setText(given); }, [given]);

  const result = useMemo(() => {
    try { return { qr: encodeQr(text, ecc), error: null }; } catch { return { qr: null, error: true }; }
  }, [text, ecc]);
  const svg = useMemo(() => (result.qr ? qrSvg(result.qr) : ""), [result.qr]);
  const isUrl = /^https?:\/\//i.test(text);

  const actions: HeaderAction[] = useMemo(() => [
    { type: "copy", getContent: () => text, tip: t("v2.qr.copy_text") },
    { type: "download", content: svg, filename: "qr.svg", tip: t("v2.qr.download") },
  ], [text, svg, t]);
  const { rendered: headerActions } = useHeaderActions(actions);

  useShellSubtitle(isUrl ? text.replace(/^https?:\/\//i, "") : t("v2.qr.text"));
  useShellSample(!isReal || !given);

  const n = result.qr ? result.qr.size + QUIET * 2 : 1;

  return (
    <BaseWidget>
      <WidgetToolbar>{headerActions}</WidgetToolbar>
      <div className="kw-qr">
        {result.qr ? (
          <svg className="kw-qr-code" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label={t("v2.qr.label", { text }) as string}>
            <rect width={n} height={n} fill="#fff" />
            <path d={result.qr.modules.flatMap((row, y) => row.map((on, x) => (on ? `M${x + QUIET},${y + QUIET}h1v1h-1z` : ""))).join("")} fill="#000" />
          </svg>
        ) : (
          <p className="kw-empty">{t("v2.qr.too_long")}</p>
        )}
        {isUrl && (
          <a className="kw-qr-link" href={text} target="_blank" rel="noopener noreferrer">{text}</a>
        )}
        <input
          className="kw-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("widget.qr.placeholder") as string}
          aria-label={t("v2.qr.text") as string}
        />
      </div>
      <WidgetFooter>
        {result.qr && <span className="v2-foot-item">{t("v2.qr.version", { version: result.qr.version, size: result.qr.size })}</span>}
        <span className="v2-foot-item">{t("v2.qr.ecc", { level: ecc })}</span>
        <span className="v2-foot-item">{t("v2.qr.chars", { count: text.length })}</span>
      </WidgetFooter>
    </BaseWidget>
  );
}
