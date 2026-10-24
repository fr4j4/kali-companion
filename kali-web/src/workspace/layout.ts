/**
 * workspace/layout.ts — Pure zone model of the neural canvas.
 *
 * The canvas is designed on a 1440 × 900 unit and scaled to the window (80–133 %). Given the
 * mode, the stage size and how many windows the active group shows, this returns the rectangles
 * every part of the canvas is painted in: the artifact zone, Kali's zone (map), the inspector,
 * Kali's voice line, the dock, and in Focus/Mosaic the group rail, the tab bar and Kali's column.
 * Components only paint these rectangles, so each mode is testable without a browser and the
 * avatar always sits at the centre of the map, wherever the map is.
 */

export const BASE_W = 1440;
export const BASE_H = 900;
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.33;
/** Below this the canvas goes compact: one artifact at a time with tabs and Kali as a bubble. */
export const COMPACT_W = 1152;
export const COMPACT_H = 720;
/** Base-unit width from which the split mode shows two full windows side by side. */
export const WIDE_BASE_W = 1800;

/** Modes the user picks for a group with artifacts. */
export type ArtifactMode = "split" | "focus" | "mosaic" | "fullscreen";
/** Mode the canvas actually paints: the stage when nothing is open. */
export type CanvasMode = "stage" | ArtifactMode;
export type KaliView = "map" | "conversation";
export type MapDensity = "stage" | "compact" | "mini";
export type MosaicPreset = "1" | "2c" | "2r" | "1+2" | "2x2";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export interface LayoutInput {
  mode: ArtifactMode;
  stage: { w: number; h: number };
  /** Windows the active group shows (not in the tray). 0 means the stage. */
  visibleWindows: number;
  kaliView?: KaliView;
  /** Fine adjustment from Settings, multiplied over the automatic scale. */
  manualScale?: number;
  /** A tray, overview or other panel occupies the artifact zone even with no window open. */
  zonePanel?: boolean;
}

export interface CanvasLayout {
  /** Effective scale (px per design unit). */
  k: number;
  mode: CanvasMode;
  compact: boolean;
  wide: boolean;
  /** Where the artifact windows (or a zone panel) go. */
  artifact: Rect | null;
  /** Kali's zone: the map, or the conversation view. Null when Kali is only a bubble. */
  kali: Rect | null;
  /** The map itself (inside `kali`); null when Kali is a panel or a bubble. */
  map: Rect | null;
  /** Centre of the avatar: the map's centre, the panel's slot or the bubble. */
  mapCenter: Point | null;
  mapDensity: MapDensity;
  /** Diameter of the avatar in px. */
  avatar: number;
  inspector: Rect | null;
  voice: Rect | null;
  dock: Rect | null;
  /** Focus / Mosaic chrome. */
  rail: Rect | null;
  tabs: Rect | null;
  column: Rect | null;
  /** Kali reduced to a bubble (fullscreen, compact). */
  bubble: Rect | null;
  /** Pills and the layout button (null where Kali's column carries them). */
  statusPill: Point | null;
  windowsPill: Point | null;
  noticesPill: Point | null;
  layoutButton: Point | null;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Automatic scale of the canvas for a window, with the manual adjustment on top. */
export function autoScale(w: number, h: number, manual = 1): number {
  const k = clamp(Math.min(w / BASE_W, h / BASE_H), MIN_SCALE, MAX_SCALE);
  return Math.round(k * manual * 1000) / 1000;
}

export function isCompact(w: number, h: number): boolean {
  return w < COMPACT_W || h < COMPACT_H;
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w: Math.max(0, w), h: Math.max(0, h) });
const scaleRect = (rect: Rect | null, k: number): Rect | null =>
  rect && { x: Math.round(rect.x * k), y: Math.round(rect.y * k), w: Math.round(rect.w * k), h: Math.round(rect.h * k) };
const scalePoint = (p: Point | null, k: number): Point | null => p && { x: Math.round(p.x * k), y: Math.round(p.y * k) };
const centerOf = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

/** Width of Kali's panel (Focus, Mosaic, later the Studio and the Hub's Lámina), design units. */
export const PANEL_W = 380;
/** The avatar's slot in Kali's panel: its size and the panel's padding before it. */
export const PANEL_AVATAR = 72;
export const PANEL_PAD = 18;
export const RAIL_W = 56;
/** Avatar on the stage map (design units): the centre of the screen, with its halo. */
export const STAGE_AVATAR = 160;
const MINIMAP_H = 180;

export function computeLayout(input: LayoutInput): CanvasLayout {
  const { stage } = input;
  const k = autoScale(stage.w, stage.h, input.manualScale ?? 1);
  const W = stage.w / k;
  const H = stage.h / k;
  const compact = isCompact(stage.w, stage.h);
  const wide = W >= WIDE_BASE_W;
  const hasContent = input.visibleWindows > 0 || !!input.zonePanel;

  let mode: CanvasMode = hasContent ? input.mode : "stage";
  // A panel in the zone (tray, overview) is shown in the split layout.
  if (input.visibleWindows === 0 && input.zonePanel) mode = "split";
  if (compact && (mode === "split" || mode === "mosaic")) mode = "focus";

  const out: CanvasLayout = {
    k, mode, compact, wide,
    artifact: null, kali: null, map: null, mapCenter: null, mapDensity: "stage", avatar: STAGE_AVATAR,
    inspector: null, voice: null, dock: null, rail: null, tabs: null, column: null, bubble: null,
    statusPill: null, windowsPill: null, noticesPill: null, layoutButton: null,
  };

  const dockY = H - 77;
  const dock = r((W - 640) / 2, dockY, 640, 52);
  const pills = () => {
    out.statusPill = { x: 20, y: 14 };
    out.windowsPill = { x: W - 20, y: 14 };
    out.noticesPill = { x: 20, y: H - 20 };
    out.layoutButton = { x: W - 20, y: H - 20 };
  };

  if (mode === "stage") {
    const kali = r(20, 56, W - 40, H - 56 - 236);
    out.kali = kali;
    out.map = input.kaliView === "conversation" ? r(kali.x, kali.y, kali.w, MINIMAP_H) : kali;
    out.mapCenter = centerOf(out.map);
    out.mapDensity = input.kaliView === "conversation" ? "mini" : "stage";
    out.avatar = input.kaliView === "conversation" ? 76 : STAGE_AVATAR;
    out.voice = r((W - 640) / 2, kali.y + kali.h + 8, 640, dockY - 8 - (kali.y + kali.h + 8));
    out.dock = dock;
    pills();
  } else if (mode === "split") {
    const aw = Math.round((W - 60) * (wide ? 0.66 : 0.594));
    const ah = H - 56 - 234;
    const artifact = r(20, 56, aw, ah);
    const kali = r(20 + aw + 20, 56, W - aw - 60, ah - 62);
    out.artifact = artifact;
    out.kali = kali;
    out.map = input.kaliView === "conversation" ? r(kali.x, kali.y, kali.w, MINIMAP_H) : kali;
    out.mapCenter = centerOf(out.map);
    out.mapDensity = input.kaliView === "conversation" ? "mini" : "compact";
    out.avatar = input.kaliView === "conversation" ? 64 : 104;
    out.inspector = r(kali.x, kali.y + kali.h, kali.w, 62);
    out.voice = r((W - 640) / 2, artifact.y + artifact.h + 12, 640, dockY - 8 - (artifact.y + artifact.h + 12));
    out.dock = dock;
    pills();
  } else if (mode === "focus" || mode === "mosaic") {
    const columnW = compact ? 0 : PANEL_W;
    out.rail = r(0, 0, RAIL_W, H);
    out.tabs = r(RAIL_W + 14, 6, W - columnW - RAIL_W - 28, 44);
    out.artifact = r(RAIL_W + 14, 52, W - columnW - RAIL_W - 28, H - 52 - 14);
    if (compact) {
      out.bubble = r(W - 20 - 64, H - 20 - 64, 64, 64);
      out.mapCenter = centerOf(out.bubble);
      out.avatar = 56;
      out.mapDensity = "mini";
    } else {
      // Kali's panel: no mini map; the avatar sits in the panel's header slot.
      const column = r(W - PANEL_W, 0, PANEL_W, H);
      out.column = column;
      out.kali = column;
      out.mapCenter = { x: column.x + PANEL_PAD + PANEL_AVATAR / 2, y: column.y + PANEL_PAD + PANEL_AVATAR / 2 };
      out.mapDensity = "mini";
      out.avatar = PANEL_AVATAR;
    }
  } else {
    // fullscreen
    out.artifact = r(0, 0, W, H);
    out.bubble = r(W - 24 - 64, H - 24 - 64, 64, 64);
    out.mapCenter = centerOf(out.bubble);
    out.avatar = 56;
    out.mapDensity = "mini";
  }

  return {
    ...out,
    artifact: scaleRect(out.artifact, k),
    kali: scaleRect(out.kali, k),
    map: scaleRect(out.map, k),
    mapCenter: scalePoint(out.mapCenter, k),
    avatar: Math.round(out.avatar * k),
    inspector: scaleRect(out.inspector, k),
    voice: scaleRect(out.voice, k),
    dock: scaleRect(out.dock, k),
    rail: scaleRect(out.rail, k),
    tabs: scaleRect(out.tabs, k),
    column: scaleRect(out.column, k),
    bubble: scaleRect(out.bubble, k),
    statusPill: scalePoint(out.statusPill, k),
    windowsPill: scalePoint(out.windowsPill, k),
    noticesPill: scalePoint(out.noticesPill, k),
    layoutButton: scalePoint(out.layoutButton, k),
  };
}

/**
 * Up to three windows of a group cascaded inside the artifact zone (split mode). Slots are stable:
 * bringing a window to the front changes its stacking, never its place. Wide screens put the
 * first two side by side.
 */
export function cascadeSlots(zone: Rect, n: number, wide = false): Rect[] {
  const { x, y, w, h } = zone;
  const at = (fx: number, fy: number, fw: number, fh: number): Rect => ({
    x: Math.round(x + w * fx), y: Math.round(y + h * fy), w: Math.round(w * fw), h: Math.round(h * fh),
  });
  if (n <= 0) return [];
  if (n === 1) return [{ ...zone }];
  if (wide) {
    const gap = 12 / w;
    const half = (1 - gap) / 2;
    const slots = [at(0, 0, half, 1), at(half + gap, 0, half, 1)];
    if (n >= 3) slots.push(at(half + gap + 0.06, 0.12, half - 0.06, 0.88));
    return slots;
  }
  if (n === 2) return [at(0, 0, 0.72, 0.82), at(0.28, 0.18, 0.72, 0.82)];
  return [at(0, 0, 0.62, 0.6), at(0.38, 0.065, 0.62, 0.6), at(0.135, 0.38, 0.62, 0.62)];
}

export interface MosaicRatios { a: number; b: number }
export interface Divider { key: "a" | "b"; orientation: "vertical" | "horizontal"; rect: Rect; /** Range the ratio may take. */ min: number; max: number }
export interface MosaicLayout { preset: MosaicPreset; panels: Rect[]; dividers: Divider[] }

export const MOSAIC_GAP = 12;
/** Minimum panel size in design units. */
export const MOSAIC_MIN = { w: 320, h: 240 };

/** Panels a preset holds. */
export const PRESET_PANELS: Record<MosaicPreset, number> = { "1": 1, "2c": 2, "2r": 2, "1+2": 3, "2x2": 4 };

/** Preset that fits `count` windows best. */
export function defaultPreset(count: number): MosaicPreset {
  if (count <= 1) return "1";
  if (count === 2) return "2c";
  if (count === 3) return "1+2";
  return "2x2";
}

/**
 * Panels of a mosaic in `area` (px) for a preset and its divider ratios. Ratios are clamped so no
 * panel goes under 320 × 240 design units (`k` converts them to px). Divider rects are the gaps
 * between panels, where the drag handles go.
 */
export function mosaicLayout(area: Rect, preset: MosaicPreset, ratios: MosaicRatios, k = 1): MosaicLayout {
  const gap = MOSAIC_GAP * k;
  const minW = MOSAIC_MIN.w * k;
  const minH = MOSAIC_MIN.h * k;
  const { x, y, w, h } = area;
  const rangeX = (span: number) => {
    const lo = clamp(minW / Math.max(1, span - gap), 0.15, 0.5);
    return { min: lo, max: 1 - lo };
  };
  const rangeY = (span: number) => {
    const lo = clamp(minH / Math.max(1, span - gap), 0.15, 0.5);
    return { min: lo, max: 1 - lo };
  };
  const round = (rect: Rect): Rect => ({ x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) });
  const splitX = (rect: Rect, ratio: number) => {
    const lw = (rect.w - gap) * ratio;
    return [
      { x: rect.x, y: rect.y, w: lw, h: rect.h },
      { x: rect.x + lw + gap, y: rect.y, w: rect.w - lw - gap, h: rect.h },
      { x: rect.x + lw, y: rect.y, w: gap, h: rect.h },
    ];
  };
  const splitY = (rect: Rect, ratio: number) => {
    const th = (rect.h - gap) * ratio;
    return [
      { x: rect.x, y: rect.y, w: rect.w, h: th },
      { x: rect.x, y: rect.y + th + gap, w: rect.w, h: rect.h - th - gap },
      { x: rect.x, y: rect.y + th, w: rect.w, h: gap },
    ];
  };

  if (preset === "1") return { preset, panels: [round(area)], dividers: [] };
  if (preset === "2c") {
    const rx = rangeX(w);
    const [p1, p2, d] = splitX(area, clamp(ratios.a, rx.min, rx.max));
    return { preset, panels: [p1, p2].map(round), dividers: [{ key: "a", orientation: "vertical", rect: round(d), ...rx }] };
  }
  if (preset === "2r") {
    const ry = rangeY(h);
    const [p1, p2, d] = splitY(area, clamp(ratios.a, ry.min, ry.max));
    return { preset, panels: [p1, p2].map(round), dividers: [{ key: "a", orientation: "horizontal", rect: round(d), ...ry }] };
  }
  if (preset === "1+2") {
    const rx = rangeX(w);
    const [left, right, d1] = splitX(area, clamp(ratios.a, rx.min, rx.max));
    const ry = rangeY(right.h);
    const [top, bottom, d2] = splitY(right, clamp(ratios.b, ry.min, ry.max));
    return {
      preset,
      panels: [left, top, bottom].map(round),
      dividers: [
        { key: "a", orientation: "vertical", rect: round(d1), ...rx },
        { key: "b", orientation: "horizontal", rect: round(d2), ...ry },
      ],
    };
  }
  // 2x2: one column ratio and one row ratio shared by both columns.
  const rx = rangeX(w);
  const ry = rangeY(h);
  const [left, right, d1] = splitX({ x, y, w, h }, clamp(ratios.a, rx.min, rx.max));
  const [tl, bl, d2] = splitY(left, clamp(ratios.b, ry.min, ry.max));
  const [tr, br] = splitY(right, clamp(ratios.b, ry.min, ry.max));
  return {
    preset,
    panels: [tl, tr, bl, br].map(round),
    dividers: [
      { key: "a", orientation: "vertical", rect: round(d1), ...rx },
      { key: "b", orientation: "horizontal", rect: round({ x, y: d2.y, w, h: gap }), ...ry },
    ],
  };
}

/** A panel this small shows only the result, without the window's controls. */
export function isCompactPanel(panel: Rect, k = 1): boolean {
  return panel.w < 420 * k || panel.h < 300 * k;
}
