import { useMemo } from "react";
import { BaseWidget } from "./base/BaseWidget";
import { SectionRenderer } from "./utils/SectionRenderer";
import { SAMPLE_PLACE } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function PlaceCardWidget({ content }: Props) {
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (isReal ? data : SAMPLE_PLACE) as typeof SAMPLE_PLACE;
  const sections = (d as any).sections;

  return (
    <BaseWidget>
      <div className="p-3 space-y-3">
        {/* Preview SVG */}
        <div className="h-32 rounded-lg bg-gradient-to-br from-accent/10 via-accent/5 to-transparent border border-white/5 flex items-center justify-center">
          <svg viewBox="0 0 200 100" className="w-full h-full opacity-40">
            <path d="M0 80 Q50 40 100 60 T200 50" fill="none" stroke="var(--accent)" strokeWidth="1" />
            <path d="M0 70 Q50 50 100 45 T200 60" fill="none" stroke="var(--accent)" strokeWidth="0.5" opacity="0.5" />
            <circle cx="100" cy="40" r="3" fill="var(--accent)" />
          </svg>
        </div>

        {/* Name */}
        <div className="text-sm font-medium text-fg">{d.name}</div>

        {/* Metadata grid */}
        {d.metadata && d.metadata.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {d.metadata.map((m, i) => (
              <div key={i} className="text-xs">
                <div className="text-muted">{m.label}</div>
                <div className="text-fg">{m.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Sections */}
        {sections && <SectionRenderer sections={sections} />}
      </div>
    </BaseWidget>
  );
}
