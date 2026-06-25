import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionValue, useSpring } from "framer-motion";
import { getAvatarCenter } from "../workspace/windowManager";

const STORAGE_KEY = "kali.thought-cloud.pos";
const DRAG_THRESHOLD = 4; // px — diferencia entre clic y arrastre

const DEFAULT_RADIUS = 180;

export interface PolarPos {
  angle: number; // radianes, 0 = +X (derecha)
  dist: number; // px en escala base (se multiplica por --mul-avatar)
}

const DEFAULT_POS: PolarPos = { angle: -Math.PI / 4, dist: DEFAULT_RADIUS }; // sup-derecha

function loadPos(radius: number): PolarPos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_POS;
    const p = JSON.parse(raw) as Partial<PolarPos>;
    if (typeof p.angle === "number" && typeof p.dist === "number" && isFinite(p.angle) && isFinite(p.dist)) {
      return { angle: p.angle, dist: Math.min(Math.max(p.dist, 0), radius) };
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
  orbitRadius: number,
): { x: number; y: number } {
  const pos = loadPos(orbitRadius);
  const center = getAvatarCenter();
  const scale = getScale();
  const dist = Math.min(pos.dist * scale, orbitRadius * scale);
  const x = center.x + Math.cos(pos.angle) * dist - cloudW / 2;
  const y = center.y + Math.sin(pos.angle) * dist - cloudH / 2;
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
 * El arrastre recalcula θ/dist desde el cursor contra el avatar center,
 * con hard clamp al círculo de radio ORBIT_RADIUS_BASE·scale.
 */
export function useThoughtCloudDrag(
  cloudWidth: number,
  cloudHeight: number,
  orbitRadius = DEFAULT_RADIUS
): UseThoughtCloudDragResult {
  const [pos, setPos] = useState<PolarPos>(() => loadPos(orbitRadius));
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const wasDragRef = useRef(false);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  // Inicializa los springs con la posición correcta (síncrono), no en (0,0).
  // Esto evita que la nube "vuele" desde la esquina superior izquierda.
  const [initPx] = useState(() => computeInitialPixelPos(cloudWidth, cloudHeight, orbitRadius));
  const mx = useSpring(useMotionValue(initPx.x), { stiffness: 350, damping: 32 });
  const my = useSpring(useMotionValue(initPx.y), { stiffness: 350, damping: 32 });

  // Recalcula posición absoluta a partir de polar + avatar center.
  // Se omite durante el arrastre (el handler de pointermove controla el motion value directo).
  const recompute = useCallback(() => {
    if (draggingRef.current) return;
    const center = getAvatarCenter();
    const scale = getScale();
    const dist = Math.min(pos.dist * scale, orbitRadius * scale);
    const x = center.x + Math.cos(pos.angle) * dist;
    const y = center.y + Math.sin(pos.angle) * dist;
    mx.set(x - cloudWidth / 2);
    my.set(y - cloudHeight / 2);
    return { center, x, y };
  }, [pos, cloudWidth, cloudHeight, mx, my, orbitRadius]);

  // Recompute forzado para el montaje inicial (ignora draggingRef).
  // El avatar puede no estar listo en el primer render (transición CSS de 500ms).
  const recomputeInitial = useCallback(() => {
    const center = getAvatarCenter();
    const scale = getScale();
    const dist = Math.min(pos.dist * scale, orbitRadius * scale);
    const x = center.x + Math.cos(pos.angle) * dist;
    const y = center.y + Math.sin(pos.angle) * dist;
    mx.set(x - cloudWidth / 2);
    my.set(y - cloudHeight / 2);
  }, [pos, cloudWidth, cloudHeight, mx, my, orbitRadius]);

  // Aplica posición inicial y reancla en resize/scroll.
  useEffect(() => {
    recomputeInitial();
    // Reintenta tras un frame y tras 500ms para capturar el avatar tras su transición CSS.
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
      // Evita que el layer subyacente (pointer-events-none) o el navegador interfieran.
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      downRef.current = { x: e.clientX, y: e.clientY };
      wasDragRef.current = false;
      draggingRef.current = true;
      setDragging(true);
    },
    []
  );

  // Ref a pos para guardar la última posición en onUp sin re-suscribir listeners.
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
      if (!wasDragRef.current && Math.hypot(dx0, dy0) < DRAG_THRESHOLD) return; // aún no es arrastre
      wasDragRef.current = true;

      const center = getAvatarCenter();
      const scale = getScale();
      const radiusMax = orbitRadius * scale;
      const dx = e.clientX - center.x;
      const dy = e.clientY - center.y;
      let dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      if (dist > radiusMax) dist = radiusMax; // HARD CLAMP

      const nx = center.x + Math.cos(angle) * dist - cloudWidth / 2;
      const ny = center.y + Math.sin(angle) * dist - cloudHeight / 2;
      mx.set(nx);
      my.set(ny);
      setPos({ angle, dist: dist / scale });
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
  }, [dragging, cloudWidth, cloudHeight, mx, my]);

  // Recalcula placement estático (para la colita y fallback).
  const center = getAvatarCenter();
  const scale = getScale();
  const x = center.x + Math.cos(pos.angle) * Math.min(pos.dist * scale, orbitRadius * scale);
  const y = center.y + Math.sin(pos.angle) * Math.min(pos.dist * scale, orbitRadius * scale);
  const pointingAngle = Math.atan2(center.y - y, center.x - x);

  return {
    placement: { x, y, pointingAngle, mx, my, anchor: center },
    dragging,
    onPointerDown,
    wasDrag: wasDragRef.current,
  };
}