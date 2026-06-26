import type { Section, AbilityItem, GridItem, TalentRow, TextObj } from "./gameDataUtils";
import { resolveText } from "./gameDataUtils";

interface Props {
  sections: Section[];
  showOriginal?: boolean;
}

function SectionStats({ fields }: { fields: { label: string; value: unknown }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {fields.map((f, i) => (
        <div key={i} className="contents">
          <span className="text-muted">{f.label}</span>
          <span className="text-foreground font-mono text-right">{String(f.value)}</span>
        </div>
      ))}
    </div>
  );
}

function SectionText({ text, showOriginal }: { text: string | TextObj; showOriginal: boolean }) {
  return <p className="text-muted text-xs">{resolveText(text, showOriginal)}</p>;
}

function SectionItemGrid({ groups }: { groups: { label?: string; items: GridItem[] }[] }) {
  return (
    <div className="space-y-1.5">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && <span className="text-muted text-xs block mb-0.5">{group.label}</span>}
          <div className="flex flex-wrap gap-1">
            {group.items.map((item, ii) => (
              <span key={ii} className="text-xs bg-elevated border border-border rounded px-1.5 py-0.5 flex items-center gap-1">
                {item.name}
                {typeof item.cost === "number" && item.cost > 0 && (
                  <span className="text-muted ml-0.5">{item.cost}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionRecipeTree({ components }: { components: GridItem[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {components.map((comp, i) => (
        <span key={i} className="text-xs bg-elevated border border-ok/30 rounded px-1.5 py-0.5">
          {comp.name}
          {typeof comp.cost === "number" && comp.cost > 0 && (
            <span className="text-muted ml-1">{comp.cost}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function SectionAbilities({ items, showOriginal }: { items: AbilityItem[]; showOriginal: boolean }) {
  return (
    <div className="space-y-1">
      {items.map((ab, i) => (
        <div key={i} className="bg-elevated border border-border rounded p-1.5">
          <div className="flex items-center gap-1">
            <span className="text-foreground text-xs font-medium">{ab.name || `#${i}`}</span>
          </div>
          {ab.description && (
            <p className="text-muted text-xs mt-0.5">{resolveText(ab.description, showOriginal)}</p>
          )}
          {ab.metadata && ab.metadata.length > 0 && (
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1 text-xs">
              {ab.metadata.map((m, mi) => (
                <div key={mi} className="contents">
                  <span className="text-muted">{m.label}</span>
                  <span className="text-foreground font-mono text-right">{m.value}</span>
                </div>
              ))}
            </div>
          )}
          {ab.attributes && ab.attributes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {ab.attributes.map((a, ai) => (
                <span key={ai} className="text-xs bg-surface border border-border rounded px-1 py-0.5">
                  {a.label}: {a.value}
                </span>
              ))}
            </div>
          )}
          {ab.lore && <p className="text-muted/60 text-xs italic mt-1">"{ab.lore}"</p>}
        </div>
      ))}
    </div>
  );
}

function SectionTalents({ rows }: { rows: TalentRow[] }) {
  return (
    <div className="space-y-0.5 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[2rem_1fr_auto_1fr] gap-x-2 items-center">
          <span className="text-muted font-mono text-right">{r.level}</span>
          <span className="text-foreground text-right">{r.left}</span>
          <span className="text-muted">|</span>
          <span className="text-foreground">{r.right}</span>
        </div>
      ))}
    </div>
  );
}

export function SectionRenderer({ sections, showOriginal = false }: Props) {
  return (
    <div className="space-y-2">
      {sections.map((section) => {
        const sectionTitle = section.title || "";

        return (
          <div key={section.id ?? section.type} className="mb-2 last:mb-0">
            {sectionTitle && (
              <span className="text-muted text-xs block mb-0.5 font-medium">{sectionTitle}</span>
            )}
            {section.type === "stats" && section.fields && (
              <SectionStats fields={section.fields} />
            )}
            {section.type === "text" && section.text && (
              <SectionText text={section.text} showOriginal={showOriginal} />
            )}
            {(section.type === "item_grid" || section.type === "build") && section.groups && (
              <SectionItemGrid groups={section.groups} />
            )}
            {section.type === "abilities" && section.items && (
              <SectionAbilities items={section.items} showOriginal={showOriginal} />
            )}
            {section.type === "talents" && section.rows && (
              <SectionTalents rows={section.rows as TalentRow[]} />
            )}
            {section.type === "recipe_tree" && section.components && (
              <SectionRecipeTree components={section.components} />
            )}
            {section.type === "images" && section.images && (
              <div className="flex flex-wrap gap-1">
                {section.images.map((imgUrl, i) => (
                  <img
                    key={i}
                    src={imgUrl}
                    alt=""
                    className="w-16 h-16 rounded object-cover border border-border"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
