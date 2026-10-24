/**
 * stage/v2/mapModel.ts — Pure model of the neural map (v2).
 *
 * The map shows only what Kali can use and is using, with the state said in words. Each node is a
 * capability (research, code, terminal…) or an artifact type open in the active group. Its state
 * comes from the tool log, the pending consent question, memory events and the voice:
 *
 *   idle · working (with a verb) · recalling · permission · failed · done (green for 6 s)
 *
 * Geometry follows the map rectangle and its density (stage cards, compact cards, mini labels):
 * nodes that matter now move inside the first ring, what Kali recalls sits between the rings and
 * what it merely has at hand stays outside. Everything here is pure so it is tested without React.
 */

import type { ToolEvent } from "../../lib/protocol";
import type { MapDensity, Point, Rect } from "../../workspace/layout";

export type NodeId =
  | "research" | "screen" | "code" | "terminal" | "files" | "desktop" | "game" | "voice" | "memory"
  | "web" | "document" | "sheet" | "dashboard" | "diagram" | "viewer" | "tasks" | "notes" | "slides"
  | "calendar" | "quiz" | "media" | "sources";

export type NodeState = "idle" | "working" | "recalling" | "permission" | "failed" | "done";

/** Capabilities always drawn (the core has their tools). Order is the clockwise ring from the top. */
export const BASE_NODES: NodeId[] = ["files", "research", "code", "memory", "voice", "game", "desktop", "terminal", "screen"];

/** Node of each artifact window type, when it is not a base capability. */
export const ARTIFACT_NODE: Record<string, NodeId> = {
  code: "code",
  diff: "code",
  terminal: "terminal",
  html: "web",
  document: "document",
  table: "sheet",
  chart: "dashboard",
  mermaid: "diagram",
  image: "viewer",
  pdf: "viewer",
  checklist: "tasks",
  tasks: "tasks",
  notes: "notes",
  slides: "slides",
  calendar: "calendar",
  quiz: "quiz",
  media: "media",
  sources: "sources",
  game: "game",
  reasoning: "memory",
};

const TOOL_NODE: Record<string, NodeId> = {
  web_search: "research",
  web_fetch: "research",
  screenshot: "screen",
  look_at_screen: "screen",
  suggest_capture: "screen",
  list_monitors: "screen",
  run_command: "terminal",
  run_tests: "terminal",
  create_terminal_session: "terminal",
  git_diff: "code",
  git_worktree: "code",
  fs_list: "files",
  fs_read: "files",
  organize_folder: "files",
  get_artifact: "files",
  list_artifacts: "files",
  manage_artifacts: "files",
  get_artifact_console: "web",
  launch_app: "desktop",
  find_apps: "desktop",
  list_windows: "desktop",
  focus_window: "desktop",
  system_info: "desktop",
  game_start: "game",
  game_action: "game",
  game_end: "game",
};

/** Verb said while a tool of the node runs (i18n key suffix under `v2.verb.`). */
const TOOL_VERB: Record<string, string> = {
  web_search: "searching",
  web_fetch: "reading",
  screenshot: "looking",
  look_at_screen: "looking",
  suggest_capture: "looking",
  list_monitors: "looking",
  run_command: "running",
  run_tests: "testing",
  create_terminal_session: "opening",
  git_diff: "reviewing",
  git_worktree: "preparing",
  fs_list: "reading",
  fs_read: "reading",
  organize_folder: "organizing",
  get_artifact: "reading",
  list_artifacts: "reading",
  manage_artifacts: "organizing",
  get_artifact_console: "testing",
  launch_app: "opening",
  find_apps: "searching",
  list_windows: "looking",
  focus_window: "opening",
  system_info: "checking",
  game_start: "playing",
  game_action: "playing",
  game_end: "playing",
  create_artifact: "writing",
  update_artifact: "writing",
};

/** Verb an artifact node says while Kali writes it. */
const ARTIFACT_VERB: Partial<Record<NodeId, string>> = {
  sheet: "calculating",
  dashboard: "calculating",
  diagram: "drawing",
  web: "updating",
};

export interface Motive { key: string; params?: Record<string, string> }
export interface DataPoint { label: string; detail?: string }

export interface NodeStatus {
  id: NodeId;
  state: NodeState;
  /** i18n key suffix of the verb (`v2.verb.<verb>`), for working/recalling. */
  verb?: string;
  motive?: Motive;
  /** When the state began (ms), for "done" expiry and ordering. */
  since: number;
  points: DataPoint[];
  /** Tool behind the current state, for the detail view. */
  tool?: string;
}

export const DONE_MS = 6000;
export const FAILED_MS = 30000;
export const RECALL_MS = 8000;

export interface TimedToolEvent extends ToolEvent { receivedAt?: number }
export interface MemoryEvent { action: "recall" | "save"; text?: string; receivedAt: number }
export interface ArtifactActivity { node: NodeId; title: string; writing: boolean; at: number }

export interface MapInputs {
  toolEvents: TimedToolEvent[];
  consentTool?: string | null;
  memory?: MemoryEvent[];
  voice?: { listening: boolean; speaking: boolean };
  /** Artifact nodes to show (types open in the active group) and what is being written now. */
  artifacts?: ArtifactActivity[];
  /** Base capabilities the session has (null = all). */
  available?: Set<NodeId> | null;
  now: number;
}

export function toolToNode(tool: string, params?: Record<string, unknown>): NodeId | null {
  if (tool === "create_artifact" || tool === "update_artifact") {
    const type = String(params?.artifact_type ?? params?.window_type ?? "").toLowerCase();
    return ARTIFACT_NODE[type] ?? (type === "html" ? "web" : type === "markdown" ? "document" : "files");
  }
  return TOOL_NODE[tool] ?? null;
}

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const base = (p: string) => p.replace(/\/+$/, "").split(/[\\/]/).pop() || p;
function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return short(url, 32); }
}

/** Why the node is doing what it does, from the tool's parameters. */
export function motiveFor(tool: string, params: Record<string, unknown> = {}): Motive {
  const s = (k: string) => (params[k] == null ? "" : String(params[k]));
  switch (tool) {
    case "web_search": return { key: "web_search", params: { q: short(s("query"), 56) } };
    case "web_fetch": return { key: "web_fetch", params: { site: domainOf(s("url")) } };
    case "fs_read": return { key: "fs_read", params: { file: base(s("path")) } };
    case "fs_list": return { key: "fs_list", params: { dir: base(s("path")) || "." } };
    case "organize_folder": return { key: "organize_folder", params: { dir: base(s("path")) } };
    case "run_command": return { key: "run_command", params: { cmd: short(s("command"), 44) } };
    case "run_tests": return { key: "run_tests" };
    case "create_terminal_session": return { key: "create_terminal_session", params: { name: short(s("display_name"), 32) } };
    case "git_diff": return { key: "git_diff" };
    case "git_worktree": return { key: "git_worktree", params: { branch: s("branch") } };
    case "screenshot":
    case "look_at_screen":
    case "suggest_capture":
    case "list_monitors": return { key: "screen" };
    case "launch_app": return { key: "launch_app", params: { app: short(s("name"), 32) } };
    case "find_apps": return { key: "find_apps", params: { q: short(s("query"), 32) } };
    case "list_windows":
    case "focus_window": return { key: "windows" };
    case "system_info": return { key: "system_info" };
    case "game_start":
    case "game_action":
    case "game_end": return { key: "game" };
    case "create_artifact": return { key: "create_artifact", params: { title: short(s("title"), 44) } };
    case "update_artifact": return s("title") ? { key: "update_artifact", params: { title: short(s("title"), 44) } } : { key: "update_artifact_untitled" };
    default: return { key: "generic", params: { tool } };
  }
}

/** The concrete thing a call used (file, site, query), hung from its node as a data point. */
export function dataPointFor(tool: string, params: Record<string, unknown> = {}): DataPoint | null {
  const s = (k: string) => (params[k] == null ? "" : String(params[k]));
  switch (tool) {
    case "web_fetch": return s("url") ? { label: domainOf(s("url")), detail: s("url") } : null;
    case "web_search": return s("query") ? { label: short(s("query"), 24), detail: s("query") } : null;
    case "fs_read":
    case "fs_list":
    case "organize_folder": return s("path") ? { label: base(s("path")), detail: s("path") } : null;
    case "run_command": return s("command") ? { label: short(s("command"), 24), detail: s("command") } : null;
    case "launch_app": return s("name") ? { label: s("name") } : null;
    case "create_artifact":
    case "update_artifact": return s("title") ? { label: short(s("title"), 24) } : null;
    default: return null;
  }
}

/** Errors are said briefly: the first line of the tool output. */
function failureMotive(ev: ToolEvent): Motive {
  const out = ev.output;
  let text = "";
  if (typeof out === "string") text = out;
  else if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    text = String(o.error ?? o.message ?? o.stderr ?? "");
  }
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line ? { key: "failed_with", params: { reason: short(line, 64) } } : { key: "failed" };
}

/** Which nodes the map draws: the base capabilities plus the artifact types open now. */
export function visibleNodes(inputs: Pick<MapInputs, "artifacts" | "available">, max = 12): NodeId[] {
  const ids: NodeId[] = BASE_NODES.filter((id) => !inputs.available || inputs.available.has(id));
  for (const a of inputs.artifacts ?? []) if (!ids.includes(a.node)) ids.push(a.node);
  return ids.slice(0, max);
}

/** Status of every visible node at `now`. */
export function nodeStatuses(inputs: MapInputs): Record<string, NodeStatus> {
  const ids = visibleNodes(inputs);
  const out: Record<string, NodeStatus> = {};
  for (const id of ids) out[id] = { id, state: "idle", since: 0, points: [] };
  const now = inputs.now;

  // Latest event per tool (a running event followed by its success is one call).
  inputs.toolEvents.forEach((ev, i) => {
    const node = toolToNode(ev.tool, ev.params);
    if (!node || !out[node]) return;
    const at = ev.receivedAt ?? i;
    const st = out[node];
    const point = dataPointFor(ev.tool, ev.params);
    if (point && !st.points.some((p) => p.label === point.label)) st.points = [...st.points, point].slice(-3);
    if (ev.status === "running") {
      out[node] = { ...st, state: "working", verb: TOOL_VERB[ev.tool] ?? "working", motive: motiveFor(ev.tool, ev.params), since: at, tool: ev.tool };
    } else if (ev.status === "success") {
      out[node] = { ...st, state: "done", verb: undefined, motive: motiveFor(ev.tool, ev.params), since: at, tool: ev.tool };
    } else if (ev.status === "error") {
      out[node] = { ...st, state: "failed", verb: undefined, motive: failureMotive(ev), since: at, tool: ev.tool };
    } else {
      out[node] = { ...st, state: "idle", verb: undefined, since: at, tool: ev.tool };
    }
  });

  // Timed states fade back to idle. Events without a timestamp (tests, replays) count as old.
  for (const st of Object.values(out)) {
    const age = now - st.since;
    if (st.state === "done" && age > DONE_MS) Object.assign(st, { state: "idle", verb: undefined });
    if (st.state === "failed" && age > FAILED_MS) Object.assign(st, { state: "idle", verb: undefined, motive: undefined });
  }

  // Artifact nodes write while their window streams.
  for (const a of inputs.artifacts ?? []) {
    const st = out[a.node];
    if (!st) continue;
    if (a.writing) {
      out[a.node] = { ...st, state: "working", verb: ARTIFACT_VERB[a.node] ?? "writing", motive: { key: "writing_artifact", params: { title: short(a.title, 44) } }, since: a.at };
    } else if (st.state === "idle" && !st.motive && a.title) {
      st.motive = { key: "artifact_open", params: { title: short(a.title, 44) } };
    }
  }

  // Memory: recalling or saving for a few seconds after the core says so.
  const mem = inputs.memory?.[inputs.memory.length - 1];
  if (mem && out.memory && now - mem.receivedAt < RECALL_MS) {
    out.memory = {
      ...out.memory,
      state: "recalling",
      verb: mem.action === "save" ? "saving" : "recalling",
      motive: mem.text ? { key: "memory_text", params: { text: short(mem.text, 64) } } : { key: mem.action === "save" ? "memory_save" : "memory_recall" },
      since: mem.receivedAt,
    };
  }

  // Voice follows the microphone and speech playback.
  if (out.voice && inputs.voice) {
    if (inputs.voice.listening) out.voice = { ...out.voice, state: "working", verb: "listening", motive: { key: "voice_listening" }, since: now };
    else if (inputs.voice.speaking) out.voice = { ...out.voice, state: "working", verb: "speaking", motive: { key: "voice_speaking" }, since: now };
  }

  // A pending consent question wins over everything on its node.
  if (inputs.consentTool) {
    const node = toolToNode(inputs.consentTool);
    if (node && out[node]) out[node] = { ...out[node], state: "permission", verb: undefined, motive: motiveFor(inputs.consentTool), since: now, tool: inputs.consentTool };
  }
  return out;
}

const PRIORITY: Record<NodeState, number> = { permission: 5, failed: 4, working: 3, recalling: 2, done: 1, idle: 0 };

/** The node the inspector shows: permission, then error, then working…, then the one picked. */
export function inspectorNode(statuses: Record<string, NodeStatus>, picked?: NodeId | null): NodeStatus | null {
  let best: NodeStatus | null = null;
  for (const st of Object.values(statuses)) {
    if (st.state === "idle") continue;
    if (!best || PRIORITY[st.state] > PRIORITY[best.state] || (PRIORITY[st.state] === PRIORITY[best.state] && st.since > best.since)) best = st;
  }
  if (best && PRIORITY[best.state] >= PRIORITY.recalling) return best;
  if (picked && statuses[picked]) return statuses[picked];
  return best;
}

// ── Geometry ─────────────────────────────────────────────

export interface RingSpec { r1: number; r2: number; /** vertical squash of the ellipse */ sy: number }

/** Ring radii by density, in px for the scale `k` (design: split rings at 130 and 190). */
export function rings(density: MapDensity, map: Rect, k: number): RingSpec {
  if (density === "stage") {
    const fit = Math.min(1, (map.h / 2 - 72 * k) / (225 * k));
    return { r1: 150 * k * fit, r2: 225 * k * fit, sy: 1 };
  }
  if (density === "compact") {
    const fit = Math.min(1, (Math.min(map.w, map.h) / 2 - 58 * k) / (190 * k));
    return { r1: 130 * k * fit, r2: 190 * k * fit, sy: 1 };
  }
  const rx = Math.max(60 * k, map.w / 2 - 34 * k);
  const ry = Math.max(40 * k, map.h / 2 - 22 * k);
  return { r1: rx * 0.62, r2: rx, sy: ry / rx };
}

export type CardSide = "left" | "right" | "top" | "bottom";

export interface PlacedNode {
  id: NodeId;
  angle: number;
  /** Where the line ends (the node's port). */
  port: Point;
  /** Top-left of the card (stage/compact) or label anchor (mini). */
  card: Rect;
  /** Side of the card the port sits on. */
  side: CardSide;
  points: Point[];
}

/** Card size per density (px). */
export function cardSize(density: MapDensity, k: number): { w: number; h: number } {
  if (density === "stage") return { w: 160 * k, h: 82 * k };
  if (density === "compact") return { w: 128 * k, h: 46 * k };
  return { w: 64 * k, h: 16 * k };
}

/** Distance of a node's port from the avatar, by state (inner ring = now). */
export function portRadius(state: NodeState, ring: RingSpec, density: MapDensity): number {
  if (density === "mini") return ring.r2;
  if (state === "idle") return ring.r2 * 1.04;
  if (state === "recalling") return (ring.r1 + ring.r2) / 2;
  return ring.r1 * 0.9;
}

/**
 * Place nodes evenly around the avatar, starting at the top and going clockwise in the canonical
 * order, so a node keeps its side of the map as others come and go. Cards sit on the far side of
 * their port and are pushed back inside the map rectangle.
 */
export function placeNodes(
  ids: NodeId[], statuses: Record<string, NodeStatus>, map: Rect, center: Point, density: MapDensity, k: number,
): PlacedNode[] {
  const ring = rings(density, map, k);
  const size = cardSize(density, k);
  const n = Math.max(1, ids.length);
  return ids.map((id, i) => {
    const angle = -90 + (360 / n) * i;
    const a = (angle * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rad = portRadius(statuses[id]?.state ?? "idle", ring, density);
    const port = { x: center.x + cos * rad, y: center.y + sin * rad * ring.sy };
    let side: CardSide;
    let cx: number;
    let cy: number;
    if (cos > 0.38) { side = "left"; cx = port.x + 6 * k; cy = port.y - size.h / 2; }
    else if (cos < -0.38) { side = "right"; cx = port.x - 6 * k - size.w; cy = port.y - size.h / 2; }
    else if (sin < 0) { side = "bottom"; cx = port.x - size.w / 2; cy = port.y - 6 * k - size.h; }
    else { side = "top"; cx = port.x - size.w / 2; cy = port.y + 6 * k; }
    // Keep the card inside the map; mini labels go inward so they never cut at the edge.
    const pad = 4 * k;
    cx = Math.min(Math.max(cx, map.x + pad), map.x + map.w - size.w - pad);
    cy = Math.min(Math.max(cy, map.y + pad), map.y + map.h - size.h - pad);
    // Data points hang outward from the port, fanning a little.
    const points = (statuses[id]?.points ?? []).slice(-(density === "stage" ? 3 : density === "compact" ? 2 : 0)).map((_, j) => {
      const spread = ((j - 1) * 14 * Math.PI) / 180;
      const d = (density === "stage" ? 26 : 20) * k + j * 9 * k;
      const ang = a + spread + (side === "left" || side === "right" ? -0.9 * Math.sign(cos) : 0);
      return { x: port.x + Math.cos(ang) * d, y: port.y + Math.sin(ang) * d * (side === "top" || side === "bottom" ? 1 : 0.8) - (side === "left" || side === "right" ? 12 * k : 0) };
    });
    return { id, angle, port, card: { x: cx, y: cy, w: size.w, h: size.h }, side, points };
  });
}

/**
 * Curve from the avatar's edge to a port. It leaves along the radial direction and bows a little
 * sideways so neighbouring connections do not overlap.
 */
export function linkPath(center: Point, coreRadius: number, to: Point): string {
  const dx = to.x - center.x;
  const dy = to.y - center.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const sx = center.x + ux * coreRadius;
  const sy = center.y + uy * coreRadius;
  const bow = Math.min(28, dist * 0.1);
  const c1 = { x: sx + ux * dist * 0.35 - uy * bow, y: sy + uy * dist * 0.35 + ux * bow };
  const c2 = { x: to.x - ux * dist * 0.25 - uy * bow * 0.5, y: to.y - uy * dist * 0.25 + ux * bow * 0.5 };
  const f = (v: number) => Math.round(v * 10) / 10;
  return `M ${f(sx)} ${f(sy)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(to.x)} ${f(to.y)}`;
}

/** Faint fixed dots scattered around the outer ring (deterministic, so nothing moves). */
export function starDots(center: Point, ring: RingSpec, count = 12): Point[] {
  const dots: Point[] = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const d = ring.r2 * (1.12 + rand() * 0.55);
    dots.push({ x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d * ring.sy });
  }
  return dots;
}
