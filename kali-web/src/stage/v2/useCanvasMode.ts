/**
 * stage/v2/useCanvasMode.ts — Hub or Studio, and the Hub's four states.
 *
 * One mode per session decides what the canvas paints; the pieces that paint do not know it.
 *
 *   hub     Kali first. Escucha (map and voice), Lámina (one artifact beside Kali's column),
 *           Explorar (the lámina alone, Kali a bubble) and Hilo (the conversation as a column).
 *           One artifact at a time: the others wait as cards under «Anteriores».
 *   studio  Several artifacts: the groups of groups.ts with Kali's panel at the side.
 *
 * The rules of the single lámina are pure functions (tested without a DOM); the hook wires them
 * to the workspace windows: a new window becomes the lámina, a closed one leaves the lists, and a
 * window focused from elsewhere (the library, a link) is brought back. Nothing here closes or
 * minimizes a window: the Hub only decides which one is seen. Mode and lámina are saved per
 * session, by artifact id, and reconciled when the windows come back after a reload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WindowData, WorkspaceAPI } from "../../workspace/types";
import { groupOf } from "../../workspace/groups";
import type { CanvasStateApi } from "./useCanvasState";

export type CanvasModeName = "hub" | "studio";
export type HubState = "escucha" | "lamina" | "explorar" | "hilo";

export interface HubModel {
  state: HubState;
  /** The window on the lámina. */
  currentId: number | null;
  /** «Anteriores»: the windows that were on the lámina, most recent first. */
  previousIds: number[];
  /** Where Hilo goes back to. */
  before: Exclude<HubState, "hilo">;
}

export const EMPTY_HUB: HubModel = { state: "escucha", currentId: null, previousIds: [], before: "escucha" };

const without = (ids: number[], id: number | null) => (id == null ? ids : ids.filter((x) => x !== id));
const front = (ids: number[], id: number | null) => (id == null ? ids : [id, ...without(ids, id)]);

/** A new artifact arrives: it takes the lámina and the one shown before becomes a card. */
export function arrive(h: HubModel, id: number): HubModel {
  if (h.currentId === id) return h;
  const state: HubState = h.state === "escucha" || h.state === "hilo" ? "lamina" : h.state;
  return { ...h, state, currentId: id, previousIds: without(front(h.previousIds, h.currentId), id) };
}

/** A card is brought back: it swaps places with the lámina. */
export function bringBack(h: HubModel, id: number): HubModel {
  const state: HubState = h.state === "explorar" ? "explorar" : "lamina";
  if (h.currentId === id) return { ...h, state };
  return { ...h, state, currentId: id, previousIds: without(front(h.previousIds, h.currentId), id) };
}

/** The lámina is put down: it becomes the first card and Kali has the screen again. */
export function closeLamina(h: HubModel): HubModel {
  return { ...h, state: "escucha", currentId: null, previousIds: front(h.previousIds, h.currentId) };
}

export function explore(h: HubModel): HubModel {
  return h.currentId == null ? h : { ...h, state: "explorar" };
}

/** Hilo in and out; it remembers where it came from. */
export function toggleThread(h: HubModel): HubModel {
  if (h.state === "hilo") return { ...h, state: h.currentId != null && h.before !== "escucha" ? h.before : h.currentId != null ? "lamina" : "escucha" };
  return { ...h, state: "hilo", before: h.state };
}

/** Esc: Explorar → Lámina → Escucha; Hilo → where it came from. Null when there is nothing to undo. */
export function back(h: HubModel): HubModel | null {
  if (h.state === "explorar") return { ...h, state: "lamina" };
  if (h.state === "hilo") return toggleThread(h);
  if (h.state === "lamina") return closeLamina(h);
  return null;
}

/** A window is gone (closed, removed): it leaves the lámina and the cards. */
export function forget(h: HubModel, id: number): HubModel {
  if (h.currentId !== id && !h.previousIds.includes(id)) return h;
  if (h.currentId === id) {
    const state: HubState = h.state === "hilo" ? "hilo" : "escucha";
    return { ...h, state, currentId: null, previousIds: without(h.previousIds, id), before: h.state === "hilo" ? "escucha" : h.before };
  }
  return { ...h, previousIds: without(h.previousIds, id) };
}

/** Coming back from the Studio: the active tab is the lámina, the rest of its group the first cards. */
export function fromStudio(h: HubModel, activeId: number | null, groupIds: number[]): HubModel {
  if (activeId == null) return { ...h, state: h.currentId != null ? "lamina" : "escucha" };
  const others = groupIds.filter((id) => id !== activeId);
  const rest = h.previousIds.filter((id) => id !== activeId && !others.includes(id) && id !== h.currentId);
  const prev = [...others, ...(h.currentId != null && h.currentId !== activeId && !others.includes(h.currentId) ? [h.currentId] : []), ...rest];
  return { ...h, state: "lamina", currentId: activeId, previousIds: prev };
}

// ── Persistence (by artifact id) ────────────────────────

export interface PersistedHub { state: HubState; current: string | null; previous: string[] }

export function toPersistedHub(h: HubModel, artifactOf: (id: number) => string | undefined): PersistedHub {
  return {
    state: h.state === "hilo" ? h.before : h.state,
    current: h.currentId != null ? artifactOf(h.currentId) ?? null : null,
    previous: h.previousIds.map(artifactOf).filter((a): a is string => !!a),
  };
}

/**
 * Place windows that come back after a reload where they were. Windows the saved state does not
 * know arrive as new ones. Returns the model and the ids it placed.
 */
export function restoreHub(h: HubModel, saved: PersistedHub, windows: Pick<WindowData, "id" | "artifactId">[]): HubModel {
  let next = h;
  const byArtifact = new Map(windows.filter((w) => w.artifactId).map((w) => [w.artifactId!, w.id]));
  const prev = saved.previous.map((a) => byArtifact.get(a)).filter((id): id is number => id != null);
  const current = saved.current ? byArtifact.get(saved.current) ?? null : null;
  next = { ...next, previousIds: [...prev, ...next.previousIds.filter((id) => !prev.includes(id) && id !== current)] };
  if (current != null) next = { ...next, currentId: current, state: saved.state === "escucha" ? "lamina" : saved.state };
  return next;
}

// ── «Muéstrame el plan» ─────────────────────────────────

const SHOW_WORDS = /\b(mu[eé]strame|ens[eé]ñame|mostrame|abre|abr[ií]|trae|tra[eé]me|vuelve a|show me|show|open|bring( back)?)\b/i;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The card a spoken "show me the plan" points at: a show verb and the card's title (or its main words). */
export function matchShowRequest(text: string, candidates: { id: number; title: string }[]): number | null {
  if (!SHOW_WORDS.test(text)) return null;
  const said = ` ${norm(text)} `;
  let best: { id: number; score: number } | null = null;
  for (const c of candidates) {
    const title = norm(c.title.replace(/\.[a-z0-9]{1,5}$/i, ""));
    if (!title) continue;
    let score = said.includes(` ${title} `) ? 100 + title.length : 0;
    if (!score) {
      const words = title.split(" ").filter((w) => w.length >= 4);
      const hits = words.filter((w) => said.includes(` ${w} `)).length;
      if (words.length && hits === words.length) score = 50 + hits;
      else if (hits >= 2) score = hits;
    }
    if (score && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

// ── Hook ────────────────────────────────────────────────

const MODE_PREFIX = "kali.v2.mode.";
const HUB_PREFIX = "kali.v2.hub.";
export const START_MODE_KEY = "kali.v2.startMode";

export function readStartMode(): CanvasModeName {
  try { return localStorage.getItem(START_MODE_KEY) === "studio" ? "studio" : "hub"; } catch { return "hub"; }
}
function loadJSON<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function saveJSON(key: string, v: unknown) {
  try { localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* storage blocked */ }
}

interface Opts {
  api: WorkspaceAPI;
  canvas: CanvasStateApi;
  sessionId: string | null;
  /** Your last message, for "show me …". */
  lastUserText?: string | null;
}

export function useCanvasMode({ api, canvas, sessionId, lastUserText }: Opts) {
  const [mode, setModeState] = useState<CanvasModeName>(() => readStartMode());
  const [hub, setHub] = useState<HubModel>(EMPTY_HUB);
  const hubRef = useRef(hub);
  hubRef.current = hub;
  const seen = useRef(new Set<number>());
  const saved = useRef<PersistedHub | null>(null);
  const windowsRef = useRef(api.windows);
  windowsRef.current = api.windows;
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  // Session change: the saved mode (or the start preference) and an empty Hub to restore into.
  useEffect(() => {
    seen.current = new Set();
    setHub(EMPTY_HUB);
    saved.current = sessionId ? loadJSON<PersistedHub>(HUB_PREFIX + sessionId) : null;
    const m = sessionId ? (() => { try { return localStorage.getItem(MODE_PREFIX + sessionId); } catch { return null; } })() : null;
    setModeState(m === "hub" || m === "studio" ? m : readStartMode());
  }, [sessionId]);

  // Windows come and go: new ones take the lámina (or their saved place), gone ones leave.
  useEffect(() => {
    let next = hubRef.current;
    const open = api.windows.filter((w) => !w.closed);
    const fresh = open.filter((w) => !seen.current.has(w.id));
    if (fresh.length) {
      const s = saved.current;
      const known = s ? fresh.filter((w) => w.artifactId && (w.artifactId === s.current || s.previous.includes(w.artifactId))) : [];
      if (s && known.length) next = restoreHub(next, s, known);
      for (const w of fresh) {
        seen.current.add(w.id);
        if (!known.includes(w)) next = arrive(next, w.id);
      }
    }
    const alive = new Set(open.map((w) => w.id));
    for (const id of [next.currentId, ...next.previousIds]) if (id != null && !alive.has(id)) next = forget(next, id);
    for (const id of [...seen.current]) if (!alive.has(id)) seen.current.delete(id);
    if (next !== hubRef.current) setHub(next);
  }, [api.windows]);

  // A window focused from outside the Hub (the library, a link, "back to canvas") is brought back.
  const lastFocus = useRef<number | null>(null);
  useEffect(() => {
    const f = api.windows.find((w) => w.focused && !w.closed);
    const id = f?.id ?? null;
    if (id === lastFocus.current) return;
    lastFocus.current = id;
    if (id == null || mode !== "hub" || hubRef.current.currentId === id) return;
    if (!seen.current.has(id)) return; // arrivals are handled above
    setHub((h) => bringBack(h, id));
  }, [api.windows, mode]);

  // Persist.
  useEffect(() => {
    if (!sessionId) return;
    saveJSON(HUB_PREFIX + sessionId, toPersistedHub(hub, (id) => windowsRef.current.find((w) => w.id === id)?.artifactId));
  }, [hub, sessionId]);

  const setMode = useCallback((m: CanvasModeName) => {
    setModeState(m);
    if (sessionId) saveJSON(MODE_PREFIX + sessionId, m);
  }, [sessionId]);

  /** Show a window on the lámina (a card, the palette, "show me…"). */
  const show = useCallback((id: number) => {
    setHub((h) => bringBack(h, id));
    canvasRef.current.focusWindow(id);
  }, []);

  const enterStudio = useCallback(() => {
    const c = canvasRef.current;
    const h = hubRef.current;
    if (h.currentId != null) {
      const g = groupOf(c.groups, h.currentId);
      c.focusWindow(h.currentId);
      if (g) c.setMode(g.mode === "mosaic" ? "mosaic" : "focus", g.id);
    } else if (c.active) {
      c.setMode(c.active.mode === "mosaic" ? "mosaic" : "focus");
    }
    setMode("studio");
  }, [setMode]);

  const enterHub = useCallback(() => {
    const c = canvasRef.current;
    const g = c.active;
    const open = (id: number) => windowsRef.current.some((w) => w.id === id && !w.closed);
    const ids = g ? g.windowIds.filter(open) : [];
    const activeId = g && g.activeId != null && ids.includes(g.activeId) ? g.activeId : ids[0] ?? null;
    setHub((h) => fromStudio(h, activeId, ids));
    setMode("hub");
  }, [setMode]);

  const toggleMode = useCallback(() => (mode === "hub" ? enterStudio() : enterHub()), [mode, enterStudio, enterHub]);

  // «Muéstrame el plan»: a card named in your message comes back to the lámina.
  const lastText = useRef<string | null | undefined>(lastUserText);
  useEffect(() => {
    if (lastUserText === lastText.current) return;
    lastText.current = lastUserText;
    if (!lastUserText || mode !== "hub") return;
    const cards = hubRef.current.previousIds.map((id) => windowsRef.current.find((w) => w.id === id)).filter((w): w is WindowData => !!w);
    const hit = matchShowRequest(lastUserText, cards.map((w) => ({ id: w.id, title: w.title })));
    if (hit != null) show(hit);
  }, [lastUserText, mode, show]);

  const actions = useMemo(() => ({
    show,
    closeLamina: () => setHub(closeLamina),
    explore: () => setHub(explore),
    toggleThread: () => setHub(toggleThread),
    back: (): boolean => {
      const next = back(hubRef.current);
      if (!next) return false;
      setHub(next);
      return true;
    },
  }), [show]);

  return { mode, hub, setMode, enterStudio, enterHub, toggleMode, ...actions };
}

export type CanvasModeApi = ReturnType<typeof useCanvasMode>;
