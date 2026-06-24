/**
 * workspace/windowManager.ts — Pure functions for window lifecycle.
 *
 * These are stateless helpers that compute new window arrays.  The actual
 * state is managed by useWorkspace, which calls these functions.
 */

import type { ArtifactWindowData, WindowType, Position, CreateWindowOpts } from "./types";
import { DEFAULT_SIZES, WINDOW_ICONS } from "./types";

let idCounter = 100;
let zCounter = 100;
let lastOffset = { x: 0, y: 0 };

/** Get the next available window id. */
export function nextId(): number {
  return ++idCounter;
}

/** Get the next z-index (monotonically increasing). */
export function nextZ(): number {
  return ++zCounter;
}

/** Compute the next position for a new window (cascading from center). */
export function getNextPosition(width: number, height: number): Position {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const margin = 60;
  const maxW = window.innerWidth - width - margin;
  const maxH = window.innerHeight - (height || 300) - 120;
  let x = cx + 180 + lastOffset.x;
  let y = cy - 100 + lastOffset.y;
  lastOffset.x += 36;
  lastOffset.y += 36;
  if (x > maxW) { x = margin; lastOffset.x = 0; }
  if (y > maxH) { y = 80; lastOffset.y = 0; }
  if (x < margin) x = margin;
  if (y < 70) y = 70;
  return { x, y };
}

/** Create a new ArtifactWindowData from opts. */
export function createWindowData(opts: Partial<CreateWindowOpts> & { type: WindowType }): ArtifactWindowData {
  const defaults = DEFAULT_SIZES[opts.type] ?? { width: 340, height: null };
  const width = opts.width ?? defaults.width;
  const height = opts.height ?? defaults.height ?? undefined;
  const pos = getNextPosition(width, height || 300);
  return {
    id: nextId(),
    artifactId: opts.artifactId,
    type: opts.type,
    title: opts.title ?? opts.type,
    icon: opts.icon ?? WINDOW_ICONS[opts.type] ?? "\u{1F4E6}",
    position: pos,
    size: { width, height: height ?? null },
    zIndex: nextZ(),
    closed: false,
    minimized: false,
    focused: true,
    content: opts.content,
    timestamp: new Date(),
  };
}

/** Focus a window by id — bring it to front and unfocus others. */
export function focusInArray(windows: ArtifactWindowData[], id: number): ArtifactWindowData[] {
  const z = nextZ();
  return windows.map((w) => ({
    ...w,
    focused: w.id === id,
    zIndex: w.id === id ? z : w.zIndex,
  }));
}

/** Close a window by id (mark closed, keep in array for recovery). */
export function closeInArray(windows: ArtifactWindowData[], id: number): ArtifactWindowData[] {
  return windows.map((w) => w.id === id ? { ...w, closed: true, focused: false } : w);
}

/** Restore a previously-closed window. */
export function restoreInArray(windows: ArtifactWindowData[], id: number): ArtifactWindowData[] {
  const z = nextZ();
  return windows.map((w) => w.id === id ? { ...w, closed: false, focused: true, zIndex: z } : { ...w, focused: false });
}

/** Duplicate a window (new id, offset position). */
export function duplicateInArray(windows: ArtifactWindowData[], id: number): { windows: ArtifactWindowData[]; newId: number } {
  const original = windows.find((w) => w.id === id);
  if (!original) return { windows, newId: -1 };
  const newId = nextId();
  const z = nextZ();
  const copy: ArtifactWindowData = {
    ...original,
    id: newId,
    title: original.title + " (copia)",
    position: { x: original.position.x + 40, y: original.position.y + 40 },
    zIndex: z,
    focused: true,
    timestamp: new Date(),
  };
  return {
    windows: windows.map((w) => ({ ...w, focused: false })).concat(copy),
    newId,
  };
}

/** Move a window to a new position. */
export function moveInArray(windows: ArtifactWindowData[], id: number, pos: Position): ArtifactWindowData[] {
  return windows.map((w) => w.id === id ? { ...w, position: pos } : w);
}

/** Resize a window. */
export function resizeInArray(windows: ArtifactWindowData[], id: number, size: { width: number; height: number | null }): ArtifactWindowData[] {
  return windows.map((w) => w.id === id ? { ...w, size } : w);
}

/** Toggle minimize. */
export function toggleMinimizeInArray(windows: ArtifactWindowData[], id: number): ArtifactWindowData[] {
  return windows.map((w) => w.id === id ? { ...w, minimized: !w.minimized } : w);
}

/** Clear all windows (mark all as closed). */
export function clearAllInArray(windows: ArtifactWindowData[]): ArtifactWindowData[] {
  return windows.map((w) => ({ ...w, closed: true, focused: false }));
}

/** Get the avatar center position (for tether anchoring). */
export function getAvatarCenter(): Position {
  const el = document.getElementById("avatar-container");
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Compute tether SVG path between avatar center and a window center. */
export function computeTetherPath(windowEl: HTMLElement): string {
  const center = getAvatarCenter();
  const rect = windowEl.getBoundingClientRect();
  const nodeX = rect.left + rect.width / 2;
  const nodeY = rect.top + rect.height / 2;
  const cp1x = center.x;
  const cp1y = nodeY;
  const cp2x = nodeX;
  const cp2y = center.y;
  return `M ${center.x} ${center.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${nodeX} ${nodeY}`;
}

/** Arrange windows in a circle around the avatar center. */
export function computeOrbitPositions(windows: ArtifactWindowData[], radius = 330): Array<{ id: number; pos: Position }> {
  const center = getAvatarCenter();
  const visible = windows.filter((w) => !w.closed);
  if (visible.length === 0) return [];
  const step = (Math.PI * 2) / visible.length;
  return visible.map((w, i) => {
    const angle = i * step;
    return {
      id: w.id,
      pos: {
        x: center.x + Math.cos(angle) * radius - w.size.width / 2,
        y: center.y + Math.sin(angle) * radius - (w.size.height || 300) / 2,
      },
    };
  });
}