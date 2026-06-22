import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GameImage } from "./GameImage";

interface ImageObj {
  path?: string;
  url?: string;
}

interface AbilityItem {
  name?: string;
  description?: string | TextObj;
  image?: ImageObj | null;
  metadata?: { label: string; value: string }[];
  attributes?: { label: string; value: string }[];
  lore?: string;
}

interface GridItem {
  name?: string;
  image?: ImageObj | null;
  cost?: number;
  url?: string;
}

interface TextObj {
  original: string;
  translated: string;
}

interface SkillLevel {
  level: number;
  ability: string;
  image?: ImageObj | null;
}

interface Section {
  id?: string;
  title?: string;
  type: string;
  text?: string | TextObj;
  fields?: { label: string; value: unknown }[];
  items?: AbilityItem[];
  groups?: { label?: string; items: GridItem[] }[];
  components?: GridItem[];
  images?: string[];
  rows?: TalentRow[];
  levels?: SkillLevel[];
}

interface Props {
  data: Record<string, unknown>;
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}

function resolveText(text: string | TextObj | undefined, showOriginal: boolean): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return showOriginal ? text.original : text.translated;
}

function isTextObj(val: unknown): val is TextObj {
  return typeof val === "object" && val !== null && "original" in val && "translated" in val;
}

function SectionStats({ fields }: { fields: { label: string; value: unknown }[] }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {fields.map((f, i) => (
        <div key={i} className="contents">
          <span className="text-muted">{t(f.label)}</span>
          <span className="text-foreground font-mono text-right">{String(f.value)}</span>
        </div>
      ))}
    </div>
  );
}

function SectionText({ text, showOriginal }: { text: string | TextObj; showOriginal: boolean }) {
  return <p className="text-muted text-xs">{resolveText(text, showOriginal)}</p>;
}

function SectionItemGrid({
  groups,
  imageReadyKeys,
  onRequestImage,
}: {
  groups: { label?: string; items: GridItem[] }[];
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && <span className="text-muted text-xs block mb-0.5">{t(group.label)}</span>}
          <div className="flex flex-wrap gap-1">
            {group.items.map((item, ii) => (
              <span key={ii} className="text-xs bg-elevated border border-border rounded px-1.5 py-0.5 flex items-center gap-1">
                {item.image?.path && imageReadyKeys && onRequestImage && (
                  <GameImage
                    imgPath={item.image.path}
                    alt={item.name ?? ""}
                    className="w-4 h-4 rounded object-cover"
                    fallbackEmoji=""
                    imageReadyKeys={imageReadyKeys}
                    onRequestImage={onRequestImage}
                  />
                )}
                {item.image?.url && (
                  <img
                    src={item.image.url}
                    alt={item.name ?? ""}
                    className="w-4 h-4 rounded object-cover"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                {item.name}
                {typeof item.cost === "number" && item.cost > 0 && (
                  <span className="text-muted ml-0.5">{item.cost}🪙</span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionRecipeTree({
  components,
  imageReadyKeys,
  onRequestImage,
}: {
  components: GridItem[];
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {components.map((comp, i) => (
        <span key={i} className="text-xs bg-elevated border border-green-600/30 rounded px-1.5 py-0.5">
          {comp.image?.path && imageReadyKeys && onRequestImage && (
            <GameImage
              imgPath={comp.image.path}
              alt={comp.name ?? ""}
              className="w-4 h-4 rounded object-cover inline-block mr-1"
              fallbackEmoji=""
              imageReadyKeys={imageReadyKeys}
              onRequestImage={onRequestImage}
            />
          )}
          {comp.image?.url && (
            <img
              src={comp.image.url}
              alt={comp.name ?? ""}
              className="w-4 h-4 rounded object-cover inline-block mr-1"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          {comp.name}
          {typeof comp.cost === "number" && comp.cost > 0 && (
            <span className="text-muted ml-1">{comp.cost}🪙</span>
          )}
        </span>
      ))}
    </div>
  );
}

function SectionAbilities({
  items,
  imageReadyKeys,
  onRequestImage,
  showOriginal,
}: {
  items: AbilityItem[];
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
  showOriginal: boolean;
}) {
  return (
    <div className="space-y-1">
      {items.map((ab, i) => (
        <div key={i} className="bg-elevated border border-border rounded p-1.5">
          <div className="flex items-center gap-1">
            {ab.image?.path && imageReadyKeys && onRequestImage && (
              <GameImage
                imgPath={ab.image.path}
                alt={ab.name ?? ""}
                className="w-6 h-6 rounded object-cover shrink-0"
                fallbackEmoji=""
                imageReadyKeys={imageReadyKeys}
                onRequestImage={onRequestImage}
              />
            )}
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

interface TalentRow {
  level: number;
  left: string;
  right: string;
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

function SectionSkillBuild({
  levels,
  imageReadyKeys,
  onRequestImage,
}: {
  levels: SkillLevel[];
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {levels.map((sl, i) => (
        <span key={i} className="text-xs bg-elevated border border-border rounded px-1.5 py-0.5 flex items-center gap-1">
          <span className="text-muted font-mono text-[10px]">{sl.level}</span>
          {sl.image?.path && imageReadyKeys && onRequestImage && (
            <GameImage
              imgPath={sl.image.path}
              alt={sl.ability}
              className="w-4 h-4 rounded object-cover"
              fallbackEmoji=""
              imageReadyKeys={imageReadyKeys}
              onRequestImage={onRequestImage}
            />
          )}
          <span>{sl.ability}</span>
        </span>
      ))}
    </div>
  );
}

export function GameResourceCard({ data, imageReadyKeys, onRequestImage }: Props) {
  const { t } = useTranslation();
  const [showOriginal, setShowOriginal] = useState(false);

  const sections = (data.sections ?? []) as Section[];
  const title = data.title as string;
  const image = (data.image ?? null) as ImageObj | null;

  const gameLabel =
    data.game === "dota" ? "Dota 2" :
    String(data.game ?? "");

  const hasTranslatedText = sections.some(
    (s) => isTextObj(s.text) || s.items?.some((ab) => isTextObj(ab.description))
  );

  if (sections.length === 0) {
    return (
      <div className="rounded-lg border border-cyan-600/30 bg-cyan-950/20 p-3 text-sm col-span-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🎮</span>
          <span className="font-medium text-foreground">{title}</span>
          <span className="text-xs text-muted ml-auto">{gameLabel}</span>
        </div>
        <p className="text-muted text-xs italic">{t("canvas.widget.empty")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-600/30 bg-cyan-950/20 p-3 text-sm col-span-1">
      <div className="flex items-center gap-2 mb-2">
        {image?.path && imageReadyKeys && onRequestImage ? (
          <GameImage
            imgPath={image.path}
            alt={title}
            className="w-12 h-12 rounded-lg object-cover shrink-0"
            fallbackEmoji="🎮"
            imageReadyKeys={imageReadyKeys}
            onRequestImage={onRequestImage}
          />
        ) : image?.url ? (
          <img
            src={image.url}
            alt={title}
            className="w-12 h-12 rounded-lg object-cover shrink-0"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span className="text-lg">🎮</span>
        )}
        <div>
          <span className="font-medium text-foreground block">{title}</span>
          <span className="text-xs text-muted">{gameLabel}</span>
        </div>
        {hasTranslatedText && (
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="ml-auto text-xs text-muted hover:text-foreground underline"
          >
            {showOriginal ? t("game.show_translated") : t("game.show_original")}
          </button>
        )}
      </div>

      {sections.map((section) => {
        const sectionTitle = section.title ? t(section.title) : "";

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
              <SectionItemGrid
                groups={section.groups}
                imageReadyKeys={imageReadyKeys}
                onRequestImage={onRequestImage}
              />
            )}
            {section.type === "abilities" && section.items && (
              <SectionAbilities
                items={section.items}
                imageReadyKeys={imageReadyKeys}
                onRequestImage={onRequestImage}
                showOriginal={showOriginal}
              />
            )}
            {section.type === "talents" && section.rows && (
              <SectionTalents rows={section.rows as TalentRow[]} />
            )}
            {section.type === "recipe_tree" && section.components && (
              <SectionRecipeTree
                components={section.components}
                imageReadyKeys={imageReadyKeys}
                onRequestImage={onRequestImage}
              />
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
