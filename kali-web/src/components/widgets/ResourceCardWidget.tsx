/**
 * ResourceCardWidget — an item or resource: name, category and price, description, a warning when
 * there is one, its figures in a two-column grid and any extra sections.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Gem, AlertTriangle } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { SectionRenderer } from "./utils/SectionRenderer";
import { SAMPLE_RESOURCE } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

export function ResourceCardWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (isReal ? data : SAMPLE_RESOURCE) as typeof SAMPLE_RESOURCE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sections = (d as any).sections;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const image = typeof (d as any).image === "string" ? (d as any).image as string : "";

  useShellSubtitle(d.category || null);
  useShellSample(!isReal);

  return (
    <BaseWidget>
      <div className="kw-card-body scrollbar-thin">
        <header className="kw-card-head">
          <span className="kw-card-portrait">{image ? <img src={image} alt="" /> : <Gem size={22} aria-hidden="true" />}</span>
          <div className="min-w-0 flex-1">
            <h3 className="kw-card-name">{d.name}</h3>
            <div className="kw-card-sub">
              {d.category}
              {d.price != null && <> · <span className="kw-mono">{d.price}</span> {t("widget.resource.coins")}</>}
            </div>
          </div>
        </header>
        {d.description && <p className="kw-card-text">{d.description}</p>}
        {d.warning && <div className="kw-callout is-warn"><AlertTriangle size={14} aria-hidden="true" /><p>{d.warning}</p></div>}
        {d.metrics && d.metrics.length > 0 && (
          <dl className="kw-facts">
            {d.metrics.map((m, i) => (
              <div key={i}><dt>{m.label}</dt><dd className="kw-mono">{m.value}</dd></div>
            ))}
          </dl>
        )}
        {sections && <div className="kw-sections"><SectionRenderer sections={sections} /></div>}
      </div>
    </BaseWidget>
  );
}
