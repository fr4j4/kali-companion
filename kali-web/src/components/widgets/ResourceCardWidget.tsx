import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { SectionRenderer } from "./utils/SectionRenderer";
import { SAMPLE_RESOURCE } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function ResourceCardWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (isReal ? data : SAMPLE_RESOURCE) as typeof SAMPLE_RESOURCE;
  const sections = (d as any).sections;

  return (
    <BaseWidget>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-lg">{'\u26A1'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg truncate">{d.name}</div>
            <div className="text-xs text-muted">{d.category} · {d.price} {t("widget.resource.coins")}</div>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted leading-relaxed">{d.description}</p>

        {/* Warning */}
        {d.warning && (
          <div className="callout callout-warn text-xs">{d.warning}</div>
        )}

        {/* Metrics */}
        {d.metrics && d.metrics.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {d.metrics.map((m, i) => (
              <div key={i} className="text-xs">
                <div className="text-muted">{m.label}</div>
                <div className="text-fg font-mono">{m.value}</div>
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
