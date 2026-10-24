/**
 * LinkWidget — a page Kali points you to, as a card: site, title, summary and the address.
 * Opens in the browser; the address can be copied from the header.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { WidgetToolbar } from "./base/WidgetChrome";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function LinkWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const url = (d.url as string) || "https://example.com";
  const title = (d.title as string) || t("widget.link.sample");
  const description = (d.description as string) || "";
  const image = typeof d.image === "string" ? d.image : "";
  const host = hostOf(url);

  const actions: HeaderAction[] = useMemo(() => [{ type: "copy", getContent: () => url, tip: t("v2.link.copy") }], [url, t]);
  const { rendered: headerActions } = useHeaderActions(actions);
  useShellSubtitle(host);
  useShellSample(!isReal || !d.url);

  return (
    <BaseWidget>
      <WidgetToolbar>{headerActions}</WidgetToolbar>
      <a href={url} target="_blank" rel="noopener noreferrer" className="kw-link">
        {image && <img className="kw-link-image" src={image} alt="" loading="lazy" />}
        <div className="kw-link-body">
          <div className="kw-link-site"><Globe size={13} aria-hidden="true" />{host}</div>
          <div className="kw-link-title">{title}</div>
          {description && <p className="kw-link-desc">{description}</p>}
          <div className="kw-link-open">{t("v2.link.open")}<ExternalLink size={13} aria-hidden="true" /></div>
        </div>
      </a>
    </BaseWidget>
  );
}
