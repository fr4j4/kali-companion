import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionValue, useSpring } from "framer-motion";
import { getAvatarCenter } from "../workspace/windowManager";

const STORAGE_KEY = "kali.thought-cloud.pos";
const DRAG_THRESHOLD = 4; // px — diferencia entre clic y arrastre

export interface OrbitParams {
  avatarRingRadius: number;     // radio del anillo blanco (escala base)
  cloudCenterToTail: number;     // distancia centro→último círculo (escala base)
  tailGap: number;               // gap mínimo anillo→cola (escala base)
  maxOrbitGap: number;           // gap máximo — rango de arrastre (escala base)
}

export interface PolarPos {
  angle: number; // radianes, 0 = +X (derecha)
  gap: number;   // distancia anillo→último círculo de cola (escala base)
}

const DEFAULT_POS: PolarPos = { angle: -Math.PI / 4, gap: 40 }; // sup-derecha, cerca del máximo

function loadPos(minGap: number, maxGap: number): PolarPos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POS;
    const p = JSON.parse(raw) as Partial<PolarPos> & { dist?: number };
    // Migración: si no hay "gap" pero hay "dist" (formato viejo), usar dist.
    const gapVal = typeof p.gap === "number" ? p.gap : typeof p.dist === "number" ? p.dist : 40;
    if (typeof p.angle === "number" && isFinite(p.angle) && isFinite(gapVal)) {
      return { angle: p.angle, gap: Math.min(Math.max(gapVal, minGap), maxGap) };
    }
  } catch {
    // ignore
  }
  return DEFAULT_POS;
}

function savePos(pos: PolarPos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function getScale(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mul-avatar")) || 1;
}

/** Calcula la posición absoluta inicial (esquina sup-izq del wrapper) de forma síncrona. */
function computeInitialPixelPos(
  cloudW: number,
  cloudH: number,
  orbit: OrbitParams,
): { x: number; y: number } {
  const pos = loadPos(orbit.tailGap, orbit.maxOrbitGap);
  const center = getAvatarCenter();
  const scale = getScale();
  const distWrapper = (orbit.avatarRingRadius + pos.gap + orbit.cloudCenterToTail) * scale;
  const x = center.x + Math.cos(pos.angle) * distWrapper - cloudW / 2;
  const y = center.y + Math.sin(pos.angle) * distWrapper - cloudH / 2;
  return { x, y };
}

export interface CloudPlacement {
  /** coordenadas absolutas (px) del centro de la nube */
  x: number;
  y: number;
  /** radianes desde la nube hacia el avatar (para rotar la colita) */
  pointingAngle: number;
  /** motion values para animar transform sin re-render */
  mx: ReturnType<typeof useSpring>;
  my: ReturnType<typeof useSpring>;
  /** ancla SVG (avatar center) — útil para el componente */
  anchor: { x: number; y: number };
}

export interface UseThoughtCloudDragResult {
  placement: CloudPlacement;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  /** true si el último gesto fue un arrastre (no un clic) — para distinguir click expandir */
  wasDrag: boolean;
}

/**
 * Mantiene la nube anclada al avatar center en coordenadas polares.
 * `gap` = distancia desde el anillo blanco del avatar hasta el último círculo de cola.
 * La distancia del avatar center al centro del wrapper es:
 *   (avatarRingRadius + gap + cloudCenterToTail) × scale
 */
export function useThoughtCloudDrag(
  cloudWidth: number,
  cloudHeight: number,
  orbit: OrbitParams,
): UseThoughtCloudDragResult {
  const [pos, setPos] = useState<PolarPos>(() => loadPos(orbit.tailGap, orbit.maxOrbitGap));
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const wasDragRef = useRef(false);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  // Inicializa los springs con la posición correcta (síncrono), no en (0,0).
  const [initPx] = useState(() => computeInitialPixelPos(cloudWidth, cloudHeight, orbit));
  const mx = useSpring(useMotionValue(initPx.x), { stiffness: 350, damping: 32 });
  const my = useSpring(useMotionValue(initPx.y), { stiffness: 350, damping: 32 });

  // Distancia del avatar center al centro del wrapper.
  const distWrapperPx = useCallback(
    (p: PolarPos, scale: number) =>
      (orbit.avatarRingRadius + p.gap + orbit.cloudCenterToTail) * scale,
    [orbit.avatarRingRadius, orbit.cloudCenterToTail],
  );

  // Recalcula posición absoluta a partir de polar + avatar center.
  const recompute = useCallback(() => {
    if (draggingRef.current) return;
    const center = getAvatarCenter();
    const scale = getScale();
    const dist = distWrapperPx(pos, scale);
    const x = center.x + Math.cos(pos.angle) * dist;
    const y = center.y + Math.sin(pos.angle) * dist;
    mx.set(x - cloudWidth / 2);
    my.set(y - cloudHeight / 2);
    return { center, x, y };
  }, [pos, cloudWidth, cloudHeight, mx, my, distWrapperPx]);

  // Recompute forzado para el montaje inicial (ignora draggingRef).
  const recomputeInitial = useCallback(() => {
    const center = getAvatarCenter();
    const scale = getScale();
    const dist = distWrapperPx(pos, scale);
    const x = center.x + Math.cos(pos.angle) * dist;
    const y = center.y + Math.sin(pos.angle) * dist;
    mx.set(x - cloudWidth / 2);
    my.set(y - cloudHeight / 2);
  }, [pos, cloudWidth, cloudHeight, mx, my, distWrapperPx]);

  // Aplica posición inicial y reancla en resize/scroll.
  useEffect(() => {
    recomputeInitial();
    const rafId = requestAnimationFrame(() => recomputeInitial());
    const timeout1 = setTimeout(() => recomputeInitial(), 100);
    const timeout2 = setTimeout(() => recomputeInitial(), 500);
    const onResize = () => recompute();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const el = document.getElementById("avatar-container");
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => recompute());
      ro.observe(el);
    }
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeout1);
      clearTimeout(timeout2);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      ro?.disconnect();
    };
  }, [recompute, recomputeInitial]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      downRef.current = { x: e.clientX, y: e.clientY };
      wasDragRef.current = false;
      draggingRef.current = true;
      setDragging(true);
    },
    []
  );

  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Listener global durante el arrastre.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const down = downRef.current;
      if (!down) return;
      const dx0 = e.clientX - down.x;
      const dy0 = e.clientY - down.y;
      if (!wasDragRef.current && Math.hypot(dx0, dy0) < DRAG_THRESHOLD) return;
      wasDragRef.current = true;

      const center = getAvatarCenter();
      const scale = getScale();
      const dx = e.clientX - center.x;
      const dy = e.clientY - center.y;
      const distCursor = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      // Convertir distancia del cursor a gap (anillo → último círculo de cola)
      let gap = distCursor - orbit.avatarRingRadius * scale - orbit.cloudCenterToTail * scale;
      const minGapPx = orbit.tailGap * scale;
      const maxGapPx = orbit.maxOrbitGap * scale;
      gap = Math.max(minGapPx, Math.min(gap, maxGapPx));

      // Recalcular posición del wrapper
      const distWrapper = orbit.avatarRingRadius * scale + gap + orbit.cloudCenterToTail * scale;
      const nx = center.x + Math.cos(angle) * distWrapper - cloudWidth / 2;
      const ny = center.y + Math.sin(angle) * distWrapper - cloudHeight / 2;
      mx.set(nx);
      my.set(ny);
      setPos({ angle, gap: gap / scale });
    };

    const onUp = () => {
      draggingRef.current = false;
      setDragging(false);
      if (wasDragRef.current) savePos(posRef.current);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, cloudWidth, cloudHeight, mx, my, orbit, distWrapperPx]);

  // Recalcula placement estático (para la colita y fallback).
  const center = getAvatarCenter();
  const scale = getScale();
  const dist = distWrapperPx(pos, scale);
  const x = center.x + Math.cos(pos.angle) * dist;
  const y = center.y + Math.sin(pos.angle) * dist;
  const pointingAngle = Math.atan2(center.y - y, center.x - x);

  return {
    placement: { x, y, pointingAngle, mx, my, anchor: center },
    dragging,
    onPointerDown,
    wasDrag: wasDragRef.current,
  };
}