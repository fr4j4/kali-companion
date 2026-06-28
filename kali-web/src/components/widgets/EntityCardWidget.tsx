import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { SectionRenderer } from "./utils/SectionRenderer";
import { SAMPLE_ENTITY } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function EntityCardWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const entityData = isReal ? data : SAMPLE_ENTITY;
  const [selectedSkill, setSelectedSkill] = useState<number | null>(null);
  const [showOriginal] = useState(false);

  const d = entityData as typeof SAMPLE_ENTITY;
  const sections = (d as any).sections;

  return (
    <BaseWidget>
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center text-lg shrink-0">
            {'\u{1F6E1}\uFE0F'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg truncate">{d.name}</div>
            {d.tags && (
              <div className="flex flex-wrap gap-1 mt-1">
                {d.tags.map((tag, i) => (
                  <span key={i} className="badge px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px]">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Attribute bars */}
        {d.bars && d.bars.map((bar, i) => (
          <div key={i}>
            <div className="flex justify-between text-xs text-muted mb-0.5">
              <span>{bar.label}</span>
              <span>{bar.value}/{bar.max}</span>
            </div>
            <div className="hero-attr-bar">
              <div className="hero-attr-fill" style={{ width: `${(bar.value / bar.max) * 100}%`, background: bar.color }} />
            </div>
          </div>
        ))}

        {/* Attributes grid */}
        {d.attributes && (
          <div className="grid grid-cols-3 gap-2">
            {d.attributes.map((attr, i) => (
              <div key={i} className="text-center">
                <div className="text-xs text-muted">{attr.label}</div>
                <div className="hero-attr-bar mt-1">
                  <div className="hero-attr-fill" style={{ width: `${(attr.value / attr.max) * 100}%`, background: "var(--accent)" }} />
                </div>
                <div className="text-xs text-fg font-mono mt-0.5">{attr.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Abilities */}
        {d.abilities && d.abilities.length > 0 && (
          <div>
            <div className="flex flex-wrap gap-1 mb-2">
              {d.abilities.map((ab, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedSkill(selectedSkill === i ? null : i)}
                  className={`hero-skill-btn text-xs px-2 py-1 rounded border border-white/10 bg-white/[0.03] text-muted hover:text-fg ${selectedSkill === i ? "active" : ""}`}
                >
                  {ab.key} {ab.name}
                </button>
              ))}
            </div>
            {selectedSkill !== null && d.abilities[selectedSkill] && (
              <div className="hero-skill-panel">
                <div className="text-xs text-fg font-medium">{d.abilities[selectedSkill].name}</div>
                <div className="text-xs text-muted mt-0.5">{d.abilities[selectedSkill].description}</div>
                <div className="text-xs text-muted mt-1">{t("widget.entity.cooldown", { n: d.abilities[selectedSkill].cd })}</div>
              </div>
            )}
          </div>
        )}

        {/* Synergies */}
        {d.synergies && d.synergies.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.synergies.map((s, i) => (
              <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-accent/5 border border-accent/20 text-accent/80">{s}</span>
            ))}
          </div>
        )}

        {/* Sections from backend data */}
        {sections && <SectionRenderer sections={sections} showOriginal={showOriginal} />}
      </div>
    </BaseWidget>
  );
}
