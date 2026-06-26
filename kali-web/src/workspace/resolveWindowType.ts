import type { ArtifactEvent } from "../lib/protocol";
import type { WindowType } from "./types";

const VALID_TYPES = new Set<WindowType>([
  "code", "link", "mermaid", "qr", "chart", "json",
  "terminal", "checklist", "quiz", "diff", "table", "controls",
  "html", "widget", "entity", "resource", "place", "media",
  "document", "image",
]);

/**
 * Legacy / domain → generic window type mapping.
 * Catches values that bypass the backend safety-net:
 *  - Old sessions persisted with domain types (hero, item, location, …)
 *  - widget_type values that leaked as windowType before the fix
 *  - Any other unrecognised domain string
 */
const LEGACY_MAP: Record<string, WindowType> = {
  hero: "entity",
  item: "resource",
  location: "place",
  ability: "entity",
  music: "media",
  video: "media",
  markdown: "document",
  text: "document",
  longtext: "document",
  img: "image",
  game_resource: "entity",
  dota_hero_card: "entity",
  dota_item_card: "resource",
  hero_card: "entity",
  item_card: "resource",
  location_card: "place",
};

export function resolveWindowType(event: ArtifactEvent): WindowType {
  const wt = event.windowType;
  if (VALID_TYPES.has(wt as WindowType)) return wt as WindowType;
  if (wt in LEGACY_MAP) return LEGACY_MAP[wt];
  if (event.type === "markdown") return "document";
  if (event.type === "diff") return "diff";
  if (event.type === "html") return "html";
  return "widget";
}