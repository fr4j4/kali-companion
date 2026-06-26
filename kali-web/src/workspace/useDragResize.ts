import type { Position, Size } from "./types";

const SNAP_GRID = 20;
const SNAP_THRESHOLD = 8;

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

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

function trySnap(el: HTMLElement, x: number, y: number, otherWindows: Array<{ el: HTMLElement }>, shiftHeld: boolean): SnapResult {
  if (shiftHeld) {
    const gx = Math.round(x / SNAP_GRID) * SNAP_GRID;
    const gy = Math.round(y / SNAP_GRID) * SNAP_GRID;
    if (Math.abs(gx - x) < SNAP_THRESHOLD) x = gx;
    if (Math.abs(gy - y) < SNAP_THRESHOLD) y = gy;
  }

  const cx = window.innerWidth / 2 - el.offsetWidth / 2;
  if (Math.abs(x - cx) < SNAP_THRESHOLD) x = cx;
  const cy = window.innerHeight / 2 - el.offsetHeight / 2;
  if (Math.abs(y - cy) < SNAP_THRESHOLD) y = cy;

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
    document.removeEventListener("pointercancel", onPointerCancel);
    onEnd(id, startPos, startPos);
  };

  const onPointerCancel = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    onEnd(id, startPos, startPos);
  };

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
}

interface ResizeOpts {
  id: number;
  el: HTMLElement;
  edge: ResizeEdge;
  pointerId: number;
  startSize: Size;
  startPos: Position;
  startMouse: { x: number; y: number };
  minW: number;
  minH: number;
  onResize: (id: number, size: Size, pos: Position) => void;
}

export function startResize(opts: ResizeOpts) {
  const { id, el, edge, startSize, startPos, startMouse, minW, minH, onResize } = opts;
  const startH = startSize.height ?? 300;
  const startW = startSize.width;

  document.body.style.userSelect = "none";
  document.body.style.pointerEvents = "none";
  el.style.pointerEvents = "auto";

  const onPointerMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startMouse.x;
    const dy = ev.clientY - startMouse.y;

    let nw = startW;
    let nh = startH;
    let nx = startPos.x;
    let ny = startPos.y;

    if (edge.includes("e")) {
      nw = Math.max(minW, startW + dx);
    }
    if (edge.includes("w")) {
      nw = Math.max(minW, startW - dx);
      nx = startPos.x + (startW - nw);
    }
    if (edge.includes("s")) {
      nh = Math.max(minH, startH + dy);
    }
    if (edge.includes("n")) {
      nh = Math.max(minH, startH - dy);
      ny = startPos.y + (startH - nh);
    }

    onResize(id, { width: nw, height: nh }, { x: nx, y: ny });
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    document.body.style.userSelect = "";
    document.body.style.pointerEvents = "";
    el.releasePointerCapture(opts.pointerId);
  };

  const onPointerCancel = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    document.body.style.userSelect = "";
    document.body.style.pointerEvents = "";
    el.releasePointerCapture(opts.pointerId);
  };

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
}
