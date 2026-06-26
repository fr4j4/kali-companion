export interface ImageObj {
  path?: string;
  url?: string;
}

export interface AbilityItem {
  name?: string;
  description?: string | TextObj;
  image?: ImageObj | null;
  metadata?: { label: string; value: string }[];
  attributes?: { label: string; value: string }[];
  lore?: string;
}

export interface GridItem {
  name?: string;
  image?: ImageObj | null;
  cost?: number;
  url?: string;
}

export interface TextObj {
  original: string;
  translated: string;
}

export interface SkillLevel {
  level: number;
  ability: string;
  image?: ImageObj | null;
}

export interface TalentRow {
  level: number;
  left: string;
  right: string;
}

export interface Section {
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

export function resolveText(text: string | TextObj | undefined, showOriginal: boolean): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return showOriginal ? text.original : text.translated;
}

export function isTextObj(val: unknown): val is TextObj {
  return typeof val === "object" && val !== null && "original" in val && "translated" in val;
}

export function hasSectionType(data: unknown, type: string): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  const sections = d.sections as Section[] | undefined;
  if (!sections) return false;
  return sections.some((s) => s.type === type);
}
