/**
 * workspace/layout.ts — Pure zone model of the neural canvas.
 *
 * The canvas is designed on a 1440 × 900 unit and scaled to the window (80–133 %). Given the
 * stage size, whether the Hub or the Studio is on and what each one shows, this returns the
 * rectangles every part of the canvas is painted in:
 *
 *   stage    nothing on screen (and the Hub's Escucha): the map with the avatar, voice, dock
 *   hub      Lámina (Kali's panel left, the artifact right), Explorar (the artifact alone, Kali a
 *            bubble) and Hilo (a reading column)
 *   studio   the group rail, the area's head, the area the panes share, Kali's panel right
 *
 * Components only paint these rectangles, so each mode is testable without a browser and the
 * avatar always sits where the layout says: the map's centre, the panel's slot or the bubble.
 */

export const BASE_W = 1440;
export const BASE_H = 900;
export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.33;
/** Below this the canvas goes compact: one artifact at a time with tabs and Kali as a bubble. */
export const COMPACT_W = 1152;
export const COMPACT_H = 720;
/** What the canvas paints: the stage when nothing is open, "hub" for the Hub's Lámina, Explorar
 * and Hilo (its Escucha is the stage), "studio" for the panes. */
export type CanvasMode = "stage" | "hub" | "studio";
/** The Hub's states (stage/v2/useCanvasMode.ts). */
export type HubLayoutState = "escucha" | "lamina" | "explorar" | "hilo";
export type MapDensity = "stage" | "compact" | "mini";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export interface LayoutInput {
  stage: { w: number; h: number };
  /** Windows on screen: the Hub's lámina (0 or 1), the Studio's tabs. 0 means the stage. */
  visibleWindows: number;
  /** Fine adjustment from Settings, multiplied over the automatic scale. */
  manualScale?: number;
  /** The Hub's state when the canvas is in the Hub; without it the canvas is the Studio. */
  hub?: HubLayoutState;
  /** Cards under «Anteriores» (Escucha shows them in a row above the dock). */
  hubCards?: number;
  /** Groups in the session: the Studio shows the group rail only when there are two or more. */
  groups?: number;
}

export interface CanvasLayout {
  /** Effective scale (px per design unit). */
  k: number;
  mode: CanvasMode;
  compact: boolean;
  /** Where the artifact windows go (the Studio's area). */
  artifact: Rect | null;
  /** Kali's zone: the map on the stage, her panel elsewhere. Null when Kali is only a bubble. */
  kali: Rect | null;
  /** The map itself (the stage); null when Kali is a panel or a bubble. */
  map: Rect | null;
  /** Centre of the avatar: the map's centre, the panel's slot or the bubble. */
  mapCenter: Point | null;
  mapDensity: MapDensity;
  /** Diameter of the avatar in px. */
  avatar: number;
  voice: Rect | null;
  dock: Rect | null;
  /** The Studio's group rail (two or more groups) and Kali's panel. */
  rail: Rect | null;
  column: Rect | null;
  /** Kali reduced to a bubble (Explorar, a small window). */
  bubble: Rect | null;
  /** Hub: the one artifact on screen, the conversation column (Hilo) and the row of cards (Escucha). */
  lamina: Rect | null;
  thread: Rect | null;
  fichas: Rect | null;
  hubState: HubLayoutState | null;
  /** Studio: the head of the area (the group, 1 · 2 · 3 · 4) and the area the panes share. */
  areaHead: Rect | null;
  area: Rect | null;
  /** Hub · Studio switch, top right (null where Kali's panel carries it). */
  modeSwitch: Point | null;
  /** The corner pills (null where Kali's panel carries them). */
  statusPill: Point | null;
  windowsPill: Point | null;
  noticesPill: Point | null;
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

/** Width of Kali's panel (the Studio and the Hub's Lámina), design units. */
export const PANEL_W = 380;
/** The avatar's slot in Kali's panel: its size and the panel's padding before it. */
export const PANEL_AVATAR = 72;
export const PANEL_PAD = 18;
export const RAIL_W = 56;
/** Avatar on the stage map (design units): the centre of the screen, with its halo. */
export const STAGE_AVATAR = 160;
/** Hub: Hilo's reading column and its avatar, the bubble, a card of «Anteriores». */
export const THREAD_W = 680;
export const THREAD_AVATAR = 56;
export const BUBBLE = 56;
export const FICHA_H = 44;
/** Studio: the head of the area and a pane's row of tabs. */
export const AREA_HEAD_H = 44;
export const PANE_TABS_H = 40;

export function computeLayout(input: LayoutInput): CanvasLayout {
  const { stage } = input;
  const k = autoScale(stage.w, stage.h, input.manualScale ?? 1);
  const W = stage.w / k;
  const H = stage.h / k;
  const compact = isCompact(stage.w, stage.h);
  const hasContent = input.visibleWindows > 0;
  const hubState: HubLayoutState | null = input.hub ? (input.hub !== "escucha" && input.hub !== "hilo" && !hasContent ? "escucha" : input.hub) : null;
  const mode: CanvasMode = hubState ? (hubState !== "escucha" ? "hub" : "stage") : hasContent ? "studio" : "stage";

  const out: CanvasLayout = {
    k, mode, compact,
    artifact: null, kali: null, map: null, mapCenter: null, mapDensity: "stage", avatar: STAGE_AVATAR,
    voice: null, dock: null, rail: null, column: null, bubble: null,
    lamina: null, thread: null, fichas: null, hubState, modeSwitch: null, areaHead: null, area: null,
    statusPill: null, windowsPill: null, noticesPill: null,
  };

  const dockY = H - 77;
  const dock = r((W - 640) / 2, dockY, 640, 52);

  if (mode === "stage") {
    const kali = r(20, 56, W - 40, H - 56 - 236);
    out.kali = kali;
    out.map = kali;
    out.mapCenter = centerOf(kali);
    // Escucha with cards: a row of «Anteriores» right above the dock, the voice above it.
    const cards = hubState && (input.hubCards ?? 0) > 0;
    const voiceBottom = cards ? dockY - 8 - FICHA_H - 10 : dockY - 8;
    out.voice = r((W - 640) / 2, kali.y + kali.h + 8, 640, voiceBottom - (kali.y + kali.h + 8));
    if (cards) out.fichas = r((W - 900) / 2, dockY - 10 - FICHA_H, 900, FICHA_H);
    out.dock = dock;
    out.statusPill = { x: 20, y: 14 };
    out.noticesPill = { x: 20, y: H - 20 };
    // The Hub · Studio switch top right; the Studio's stage keeps the windows pill there too.
    out.modeSwitch = { x: W - 20, y: 14 };
    if (!hubState) out.windowsPill = { x: W - 20, y: 58 };
  } else if (mode === "hub") {
    const top = 56;
    const bottom = 54;
    if (hubState === "lamina" && !compact) {
      // P2, Kali presenter: her panel on the left, the lámina on the right.
      const column = r(20, top, PANEL_W, H - top - bottom);
      out.column = column;
      out.kali = column;
      out.lamina = r(column.x + column.w + 20, top, W - (column.x + column.w + 20) - 20, H - top - bottom);
      out.mapCenter = { x: column.x + PANEL_PAD + PANEL_AVATAR / 2, y: column.y + PANEL_PAD + PANEL_AVATAR / 2 };
      out.avatar = PANEL_AVATAR;
      out.mapDensity = "mini";
      // Status and notices live in the panel's header.
    } else if (hubState === "hilo") {
      const w = Math.min(THREAD_W, W - 24);
      const thread = r((W - w) / 2, 24, w, H - 48);
      out.thread = thread;
      out.mapCenter = { x: thread.x + 16 + THREAD_AVATAR / 2, y: thread.y + 16 + THREAD_AVATAR / 2 };
      out.avatar = THREAD_AVATAR;
      out.mapDensity = "mini";
      out.statusPill = { x: 20, y: 14 };
      out.modeSwitch = { x: W - 20, y: 14 };
      out.noticesPill = { x: 20, y: H - 20 };
    } else {
      // Explorar (and the lámina on a small window): the artifact takes the screen, Kali a bubble.
      // On a small window the lámina leaves a strip at the bottom: notices, the cards, the bubble.
      const strip = hubState === "explorar" ? 0 : BUBBLE + 20;
      out.lamina = hubState === "explorar" ? r(0, 0, W, H) : r(12, top, W - 24, H - top - 12 - strip);
      out.bubble = r(W - 20 - BUBBLE, H - 12 - BUBBLE, BUBBLE, BUBBLE);
      if (strip) {
        out.noticesPill = { x: 12, y: H - 12 - (BUBBLE - 36) / 2 };
        if ((input.hubCards ?? 0) > 0) out.fichas = r(150, H - 12 - (BUBBLE + FICHA_H) / 2, W - 150 - 40 - BUBBLE - 20, FICHA_H);
      }
      out.mapCenter = centerOf(out.bubble);
      out.avatar = BUBBLE;
      out.mapDensity = "mini";
      if (hubState !== "explorar") { out.statusPill = { x: 12, y: 10 }; out.modeSwitch = { x: W - 12, y: 10 }; }
    }
  } else if (mode === "studio") {
    // T2: the group rail (with two or more groups), the area's head and its panes, Kali's panel.
    const rail = (input.groups ?? 1) > 1 ? RAIL_W : 0;
    const columnW = compact ? 0 : PANEL_W;
    if (rail) out.rail = r(0, 0, RAIL_W, H);
    const x = rail + 14;
    const w = W - columnW - x - 14;
    out.areaHead = r(x, 6, w, AREA_HEAD_H);
    // On a small window Kali is a bubble in a strip under the area (with the notices).
    const strip = compact ? 64 + 16 : 0;
    out.area = r(x, 6 + AREA_HEAD_H + 4, w, H - (6 + AREA_HEAD_H + 4) - 14 - strip);
    out.artifact = out.area;
    if (compact) {
      out.bubble = r(W - 14 - 64, H - 10 - 64, 64, 64);
      out.mapCenter = centerOf(out.bubble);
      out.avatar = 56;
      out.mapDensity = "mini";
      out.noticesPill = { x: x, y: H - 24 };
    } else {
      const column = r(W - PANEL_W, 0, PANEL_W, H);
      out.column = column;
      out.kali = column;
      out.mapCenter = { x: column.x + PANEL_PAD + PANEL_AVATAR / 2, y: column.y + PANEL_PAD + PANEL_AVATAR / 2 };
      out.mapDensity = "mini";
      out.avatar = PANEL_AVATAR;
    }
  }

  return {
    ...out,
    artifact: scaleRect(out.artifact, k),
    kali: scaleRect(out.kali, k),
    map: scaleRect(out.map, k),
    mapCenter: scalePoint(out.mapCenter, k),
    avatar: Math.round(out.avatar * k),
    voice: scaleRect(out.voice, k),
    dock: scaleRect(out.dock, k),
    rail: scaleRect(out.rail, k),
    column: scaleRect(out.column, k),
    bubble: scaleRect(out.bubble, k),
    lamina: scaleRect(out.lamina, k),
    areaHead: scaleRect(out.areaHead, k),
    area: scaleRect(out.area, k),
    thread: scaleRect(out.thread, k),
    fichas: scaleRect(out.fichas, k),
    modeSwitch: scalePoint(out.modeSwitch, k),
    statusPill: scalePoint(out.statusPill, k),
    windowsPill: scalePoint(out.windowsPill, k),
    noticesPill: scalePoint(out.noticesPill, k),
  };
}

/** A panel this small shows only the result, without the window's controls. */
export function isCompactPanel(panel: Rect, k = 1): boolean {
  return panel.w < 420 * k || panel.h < 300 * k;
}
