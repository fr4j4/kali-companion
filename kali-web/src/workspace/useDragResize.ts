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
    // Use offsetWidth/offsetHeight (unaffected by transform: scale) and
    // the wrapper's inline left/top style (the source of truth for window
    // position) instead of getBoundingClientRect(), which returns scaled
    // values during the awEnter entry animation and stale 400px
    // placeholders when content-visibility:auto virtualizes offscreen
    // siblings. The .kw element carries data-window-id but not left/top;
    // those live on its .kw-wrapper parent.
    const wrapper = other.el.closest(".kw-wrapper") as HTMLElement | null;
    const posEl = wrapper ?? other.el;
    const aw = other.el.offsetWidth;
    const ah = other.el.offsetHeight;
    const ax = parseFloat(posEl.style.left) || 0;
    const ay = parseFloat(posEl.style.top) || 0;
    if (Math.abs(x - ax) < SNAP_THRESHOLD) x = ax;
    if (Math.abs(x + el.offsetWidth - ax - aw) < SNAP_THRESHOLD) x = ax + aw - el.offsetWidth;
    if (Math.abs(y - ay) < SNAP_THRESHOLD) y = ay;
    if (Math.abs(y + el.offsetHeight - ay - ah) < SNAP_THRESHOLD) y = ay + ah - el.offsetHeight;
  }

  return { pos: { x, y }, snapped: true };
}

export function startDrag(opts: DragOpts) {
  const { id, el, startPos, startMouse, onMove, onEnd, otherWindows, shiftHeld } = opts;
  let lastPos = startPos;

  const onPointerMove = (ev: PointerEvent) => {
    let nx = startPos.x + (ev.clientX - startMouse.x);
    let ny = startPos.y + (ev.clientY - startMouse.y);
    nx = Math.max(0, Math.min(window.innerWidth - 80, nx));
    ny = Math.max(50, Math.min(window.innerHeight - 60, ny));
    const snap = trySnap(el, nx, ny, otherWindows, shiftHeld());
    lastPos = snap.pos;
    onMove(id, snap.pos);
  };

  const cleanup = () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
  };

  const onPointerUp = () => {
    cleanup();
    onEnd(id, lastPos, startPos);
  };

  const onPointerCancel = () => {
    cleanup();
    onEnd(id, lastPos, startPos);
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
  /** Maintain the content body aspect ratio. Provide the header logical height so the body can be locked. */
  bodyAspectRatio?: number;
  /** Logical height of the window header. Defaults to 0 (whole window). */
  headerHeight?: number;
  /** Current UI scale applied to the window element. Defaults to 1. */
  winScale?: number;
}

function getHeaderLogical(
  el: HTMLElement,
  headerHeight: number | undefined,
  winScale: number,
): number {
  if (headerHeight !== undefined) return headerHeight / winScale;
  const header = el.querySelector(".kw-header") as HTMLElement | null;
  if (!header) return 0;
  return header.offsetHeight / winScale;
}

export function startResize(opts: ResizeOpts) {
  const { id, el, edge, startSize, startPos, startMouse, minW, minH, onResize, bodyAspectRatio, winScale = 1 } = opts;
  const startH = startSize.height ?? 300;
  const startW = startSize.width;
  const headerLogical = getHeaderLogical(el, opts.headerHeight, winScale);

  document.body.style.userSelect = "none";
  document.body.style.pointerEvents = "none";
  el.style.pointerEvents = "auto";

  const safetyTimer = setTimeout(() => {
    document.body.style.userSelect = "";
    document.body.style.pointerEvents = "";
  }, 5000);

  const cleanup = () => {
    clearTimeout(safetyTimer);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerCancel);
    document.body.style.userSelect = "";
    document.body.style.pointerEvents = "";
    el.releasePointerCapture(opts.pointerId);
  };

  const applyAspectRatio = (nw: number, nh: number): { width: number; height: number } => {
    if (!bodyAspectRatio || bodyAspectRatio <= 0 || nw <= 0 || nh <= 0) {
      return { width: nw, height: nh };
    }
    // Lock body aspect ratio: (nw) / (nh - headerLogical) = bodyAspectRatio
    const targetBodyH = nw / bodyAspectRatio;
    const targetWindowH = targetBodyH + headerLogical;
    return { width: nw, height: targetWindowH };
  };

  const onPointerMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startMouse.x;
    const dy = ev.clientY - startMouse.y;

    let nw = startW;
    let nh = startH;
    let nx = startPos.x;
    let ny = startPos.y;

    const isHorizontalEdge = edge.includes("e") || edge.includes("w");
    const isVerticalEdge = edge.includes("n") || edge.includes("s");

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

    if (bodyAspectRatio) {
      if (isHorizontalEdge && !isVerticalEdge) {
        // dragging horizontal handles: width drives height
        const { height } = applyAspectRatio(nw, nh);
        nh = height;
      } else if (isVerticalEdge && !isHorizontalEdge) {
        // dragging vertical handles: height drives width
        const bodyH = Math.max(0, nh - headerLogical);
        nw = Math.max(minW, bodyH * bodyAspectRatio);
        if (edge.includes("w")) {
          nx = startPos.x + (startW - nw);
        }
      } else {
        // diagonal: pick the larger of width-driven / height-driven to keep pointer under the handle
        const widthDrivenH = applyAspectRatio(nw, nh).height;
        const bodyH = Math.max(0, nh - headerLogical);
        const heightDrivenW = Math.max(minW, bodyH * bodyAspectRatio);
        if (Math.abs(widthDrivenH - nh) <= Math.abs(heightDrivenW - nw)) {
          nh = widthDrivenH;
        } else {
          nw = heightDrivenW;
          if (edge.includes("w")) {
            nx = startPos.x + (startW - nw);
          }
        }
      }
    }

    onResize(id, { width: nw, height: nh }, { x: nx, y: ny });
  };

  const onPointerUp = () => cleanup();
  const onPointerCancel = () => cleanup();

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
}
