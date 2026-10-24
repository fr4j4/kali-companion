/**
 * PlaceCardWidget — a place: a picture (or a quiet contour drawing when there is none), the name,
 * its facts in two columns and any extra sections.
 */

import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { SectionRenderer } from "./utils/SectionRenderer";
import { SAMPLE_PLACE } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

export function PlaceCardWidget({ content }: Props) {
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (isReal ? data : SAMPLE_PLACE) as typeof SAMPLE_PLACE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sections = (d as any).sections;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const image = typeof (d as any).image === "string" ? (d as any).image as string : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const region = typeof (d as any).region === "string" ? (d as any).region as string : "";

  useShellSubtitle(region || null);
  useShellSample(!isReal);

  return (
    <BaseWidget>
      <div className="kw-card-body scrollbar-thin">
        <div className="kw-place-hero">
          {image ? <img src={image} alt="" /> : (
            <svg viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 80 Q50 40 100 60 T200 50" fill="none" stroke="var(--accent)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <path d="M0 70 Q50 50 100 45 T200 60" fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.45" vectorEffect="non-scaling-stroke" />
              <path d="M0 90 Q60 70 110 78 T200 72" fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.25" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          <span className="kw-place-pin"><MapPin size={16} aria-hidden="true" /></span>
        </div>
        <h3 className="kw-card-name">{d.name}</h3>
        {d.metadata && d.metadata.length > 0 && (
          <dl className="kw-facts">
            {d.metadata.map((m, i) => (
              <div key={i}><dt>{m.label}</dt><dd>{m.value}</dd></div>
            ))}
          </dl>
        )}
        {sections && <div className="kw-sections"><SectionRenderer sections={sections} /></div>}
      </div>
    </BaseWidget>
  );
}
