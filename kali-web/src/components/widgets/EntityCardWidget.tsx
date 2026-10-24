/**
 * EntityCardWidget — a character or ability sheet: portrait tile, name and tags, bars and
 * attributes as quiet meters, abilities as chips that open their detail, and any extra sections
 * the core sends.
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { SectionRenderer } from "./utils/SectionRenderer";
import { SAMPLE_ENTITY } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import { useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

export function EntityCardWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const entityData = isReal ? data : SAMPLE_ENTITY;
  const [selectedSkill, setSelectedSkill] = useState<number | null>(null);

  const d = entityData as typeof SAMPLE_ENTITY;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sections = (d as any).sections;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const image = typeof (d as any).image === "string" ? (d as any).image as string : "";

  useShellSubtitle(d.tags?.join(" · ") || null);
  useShellSample(!isReal);

  return (
    <BaseWidget>
      <div className="kw-card-body scrollbar-thin">
        <header className="kw-card-head">
          <span className="kw-card-portrait">{image ? <img src={image} alt="" /> : <Shield size={22} aria-hidden="true" />}</span>
          <div className="min-w-0 flex-1">
            <h3 className="kw-card-name">{d.name}</h3>
            {d.tags && d.tags.length > 0 && (
              <div className="kw-chips">{d.tags.map((tag, i) => <span key={i} className="kw-chip">{tag}</span>)}</div>
            )}
          </div>
        </header>

        {d.bars && d.bars.length > 0 && (
          <div className="kw-meters">
            {d.bars.map((bar, i) => (
              <div key={i} className="kw-meter">
                <div className="kw-meter-head"><span>{bar.label}</span><span className="kw-mono">{bar.value}/{bar.max}</span></div>
                <div className="kw-break-track"><div style={{ width: `${Math.min(100, (bar.value / bar.max) * 100)}%`, background: bar.color || undefined }} /></div>
              </div>
            ))}
          </div>
        )}

        {d.attributes && d.attributes.length > 0 && (
          <div className="kw-stats">
            {d.attributes.map((attr, i) => (
              <div key={i} className="kw-stat">
                <div className="kw-stat-label">{attr.label}</div>
                <div className="kw-stat-value">{attr.value}</div>
                <div className="kw-break-track"><div style={{ width: `${Math.min(100, (attr.value / attr.max) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}

        {d.abilities && d.abilities.length > 0 && (
          <section>
            <div className="kw-side-title is-inline">{t("v2.entity.abilities")}</div>
            <div className="kw-chips">
              {d.abilities.map((ab, i) => (
                <button key={i} type="button" className="kw-chip is-button" aria-pressed={selectedSkill === i} onClick={() => setSelectedSkill(selectedSkill === i ? null : i)}>
                  {ab.key && <span className="kw-mono">{ab.key}</span>}{ab.name}
                </button>
              ))}
            </div>
            {selectedSkill !== null && d.abilities[selectedSkill] && (
              <div className="kw-callout">
                <strong>{d.abilities[selectedSkill].name}</strong>
                <p>{d.abilities[selectedSkill].description}</p>
                {d.abilities[selectedSkill].cd != null && <p className="kw-dim">{t("widget.entity.cooldown", { n: d.abilities[selectedSkill].cd })}</p>}
              </div>
            )}
          </section>
        )}

        {d.synergies && d.synergies.length > 0 && (
          <section>
            <div className="kw-side-title is-inline">{t("v2.entity.synergies")}</div>
            <div className="kw-chips">{d.synergies.map((s, i) => <span key={i} className="kw-chip is-accent">{s}</span>)}</div>
          </section>
        )}

        {sections && <div className="kw-sections"><SectionRenderer sections={sections} showOriginal={false} /></div>}
      </div>
    </BaseWidget>
  );
}
