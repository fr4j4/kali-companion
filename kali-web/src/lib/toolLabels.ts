/**
 * lib/toolLabels.ts — The human name and icon of each tool Kali uses.
 *
 * The core speaks in internal names (web_search, fs_read…); the interface never shows them.
 * Known tools have a translated name under `toolname.<tool>`; anything else is turned into words
 * ("game_action" → "Game action"). The icon is the one of the map node the tool belongs to.
 */

import { Wrench, type LucideIcon } from "lucide-react";
import { toolToNode } from "../stage/v2/mapModel";
import { NODE_ICONS } from "../stage/v2/nodeIcons";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** "game_action" → "Game action". */
export function humanizeTool(tool: string): string {
  const words = tool.replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : tool;
}

export function toolLabel(t: T, tool: string): string {
  return t(`toolname.${tool}`, { defaultValue: humanizeTool(tool) });
}

export function toolIcon(tool: string, params?: Record<string, unknown>): LucideIcon {
  const node = toolToNode(tool, params);
  return (node && NODE_ICONS[node]) || Wrench;
}
