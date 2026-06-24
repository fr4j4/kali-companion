/**
 * workspace/useDragResize.ts — Drag + resize + snap logic for a single window.
 *
 * Returns event handlers to attach to the window header (drag) and the resize
 * handle.  Snapping is supported:
 *   - Snap to grid (Shift held, 20px)
 *   - Snap to center of canvas
 *   - Snap to edges of other windows
 *
 * Mobile (<768px) disables drag/resize entirely (grid auto mode).
 */

import type { Position, Size } from "./types";

const SNAP_GRID = 20;
const SNAP_THRESHOLD = 8;

interface SnapResult {
  pos: Position;
  snapped: boolean;
}

interface DragOpts {
  id: number;
  el: HTMLElement;
  startPos: Position;
  startMouse: { x: number; y: number };
  onMove: (id: number, pos: Position) => void;
  onEnd: (id: number, finalPos: Position, prevPos: Position) => void;
  otherWindows: Array<{ el: HTMLElement; id: number }>;
  shiftHeld: () => boolean;
}

/** Try snapping a position to grid, center, or other window edges. */
function trySnap(el: HTMLElement, x: number, y: number, otherWindows: Array<{ el: HTMLElement }>, shiftHeld: boolean): SnapResult {
  // Snap to grid (Shift held)
  if (shiftHeld) {
    const gx = Math.round(x / SNAP_GRID) * SNAP_GRID;
    const gy = Math.round(y / SNAP_GRID) * SNAP_GRID;
    if (Math.abs(gx - x) < SNAP_THRESHOLD) x = gx;
    if (Math.abs(gy - y) < SNAP_THRESHOLD) y = gy;
  }

  // Snap to center
  const cx = window.innerWidth / 2 - el.offsetWidth / 2;
  if (Math.abs(x - cx) < SNAP_THRESHOLD) x = cx;
  const cy = window.innerHeight / 2 - el.offsetHeight / 2;
  if (Math.abs(y - cy) < SNAP_THRESHOLD) y = cy;

  // Snap to other windows' edges
  for (const other of otherWindows) {
    const r = other.el.getBoundingClientRect();
    const ax = r.left, ay = r.top, aw = r.width, ah = r.height;
    if (Math.abs(x - ax) < SNAP_THRESHOLD) x = ax;
    if (Math.abs(x + el.offsetWidth - ax - aw) < SNAP_THRESHOLD) x = ax + aw - el.offsetWidth;
    if (Math.abs(y - ay) < SNAP_THRESHOLD) y = ay;
    if (Math.abs(y + el.offsetHeight - ay - ah) < SNAP_THRESHOLD) y = ay + ah - el.offsetHeight;
  }

  return { pos: { x, y }, snapped: true };
}

/** Start a drag operation.  Call from the header pointerdown handler. */
export function startDrag(opts: DragOpts) {
  const { id, el, startPos, startMouse, onMove, onEnd, otherWindows, shiftHeld } = opts;

  const onPointerMove = (ev: PointerEvent) => {
    let nx = startPos.x + (ev.clientX - startMouse.x);
    let ny = startPos.y + (ev.clientY - startMouse.y);
    nx = Math.max(0, Math.min(window.innerWidth - 80, nx));
    ny = Math.max(50, Math.min(window.innerHeight - 60, ny));
    const snap = trySnap(el, nx, ny, otherWindows, shiftHeld());
    onMove(id, snap.pos);
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    onEnd(id, startPos, startPos); // Simplified — parent tracks actual final pos
  };

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
}

interface ResizeOpts {
  id: number;
  el: HTMLElement;
  startSize: Size;
  startMouse: { x: number; y: number };
  minW: number;
  minH: number;
  onResize: (id: number, size: Size) => void;
}

/** Start a resize operation.  Call from the resize handle pointerdown. */
export function startResize(opts: ResizeOpts) {
  const { id, startSize, startMouse, minW, minH, onResize } = opts;
  const startH = startSize.height ?? 300;

  const onPointerMove = (ev: PointerEvent) => {
    const nw = Math.max(minW, startSize.width + (ev.clientX - startMouse.x));
    const nh = Math.max(minH, startH + (ev.clientY - startMouse.y));
    onResize(id, { width: nw, height: nh });
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  };

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
}