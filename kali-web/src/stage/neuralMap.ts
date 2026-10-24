/**
 * stage/neuralMap.ts — Pure model of the neural map around the avatar.
 *
 * The map shows what Kali is doing as a ring of nodes tied to the avatar by curves. Which tools
 * light which node, where the nodes sit and the curve geometry are all computed here from the stage
 * size, so the map scales with the window instead of being drawn at a fixed resolution.
 */

export type NodeId = "research" | "screen" | "code" | "files" | "desktop" | "games" | "voice";
export type NodeTone = "action" | "context";

export interface NodeDef {
  id: NodeId;
  /** Angle in degrees around the avatar, 0 = right, 90 = below (screen coordinates). */
  angle: number;
  tone: NodeTone;
  /** Kept when the stage is too narrow for the full ring. */
  essential: boolean;
}

/** Order matters: it is the clockwise ring starting top-left. */
export const NODES: NodeDef[] = [
  { id: "files", angle: -130, tone: "context", essential: true },
  { id: "research", angle: -50, tone: "action", essential: true },
  { id: "screen", angle: 0, tone: "action", essential: false },
  { id: "code", angle: 50, tone: "action", essential: true },
  { id: "voice", angle: 90, tone: "action", essential: true },
  { id: "games", angle: 130, tone: "context", essential: true },
  { id: "desktop", angle: 180, tone: "context", essential: false },
];

const TOOL_NODE: Record<string, NodeId> = {
  web_search: "research",
  web_fetch: "research",
  screenshot: "screen",
  look_at_screen: "screen",
  suggest_capture: "screen",
  list_monitors: "screen",
  run_command: "code",
  run_tests: "code",
  create_terminal_session: "code",
  git_diff: "code",
  git_worktree: "code",
  fs_list: "files",
  fs_read: "files",
  organize_folder: "files",
  create_artifact: "files",
  update_artifact: "files",
  get_artifact: "files",
  list_artifacts: "files",
  manage_artifacts: "files",
  get_artifact_console: "files",
  launch_app: "desktop",
  find_apps: "desktop",
  list_windows: "desktop",
  focus_window: "desktop",
  system_info: "desktop",
  game_start: "games",
  game_action: "games",
  game_end: "games",
};

/** Node a tool call belongs to, or null for tools the map does not show. */
export function toolToNode(tool: string): NodeId | null {
  return TOOL_NODE[tool] ?? null;
}

export type NodeState = "idle" | "active";

export interface ToolLike { tool: string; status: string }

/**
 * Per-node state from the tool log. A node is active while the latest event of any of its tools
 * is still running; the voice node follows the microphone and the speech playback instead.
 */
export function nodeStates(toolEvents: ToolLike[], voice: { listening: boolean; speaking: boolean }): Record<NodeId, NodeState> {
  const states = Object.fromEntries(NODES.map((n) => [n.id, "idle"])) as Record<NodeId, NodeState>;
  const latest = new Map<string, string>();
  for (const e of toolEvents) latest.set(e.tool, e.status);
  for (const [tool, status] of latest) {
    const node = toolToNode(tool);
    if (node && status === "running") states[node] = "active";
  }
  if (voice.listening || voice.speaking) states.voice = "active";
  return states;
}

export interface Point { x: number; y: number }
export interface Placed { id: NodeId; tone: NodeTone; pos: Point; angle: number }

export interface MapLayout {
  nodes: Placed[];
  /** Ring radii used (px). */
  rx: number;
  ry: number;
}

/**
 * Place the ring around `center`. The radii follow the stage so nothing leaves the screen, and never
 * shrink inside the avatar (`coreRadius`). Narrow stages keep only the essential nodes.
 */
export function layoutNodes(stage: { w: number; h: number }, center: Point, coreRadius: number): MapLayout | null {
  if (stage.w < 760 || stage.h < 520) return null;
  const compact = stage.w < 1280;
  const defs = compact ? NODES.filter((n) => n.essential) : NODES;
  const rx = Math.max(coreRadius + 130, stage.w * (compact ? 0.24 : 0.22));
  // Leave room for the top bar above and the response text below.
  const maxRy = Math.min(center.y - 96, stage.h * 0.76 - center.y - 40);
  const ry = Math.max(coreRadius + 60, Math.min(stage.h * 0.23, maxRy));
  const nodes = defs.map((d) => {
    const a = (d.angle * Math.PI) / 180;
    return { id: d.id, tone: d.tone, angle: d.angle, pos: { x: center.x + Math.cos(a) * rx, y: center.y + Math.sin(a) * ry } };
  });
  return { nodes, rx, ry };
}

/**
 * Cubic Bézier from the avatar's edge to a node. The curve leaves along the radial direction and
 * bows sideways so neighbouring connections do not overlap.
 */
export function connectionPath(center: Point, coreRadius: number, to: Point): string {
  const dx = to.x - center.x;
  const dy = to.y - center.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const sx = center.x + ux * coreRadius;
  const sy = center.y + uy * coreRadius;
  const bow = Math.min(40, dist * 0.12);
  const c1 = { x: sx + ux * dist * 0.3 - uy * bow, y: sy + uy * dist * 0.3 + ux * bow };
  const c2 = { x: to.x - ux * dist * 0.3 - uy * bow, y: to.y - uy * dist * 0.3 + ux * bow };
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M ${f(sx)} ${f(sy)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(to.x)} ${f(to.y)}`;
}
