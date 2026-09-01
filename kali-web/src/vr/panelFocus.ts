import type * as THREE from "three";

/** Foco global de paneles VR: el artefacto pinchado recibe el scroll del thumbstick. */
export type FocusedPanel = { id: string; title: string; rootObj: THREE.Object3D };

let current: FocusedPanel | null = null;
const listeners = new Set<(f: FocusedPanel | null) => void>();

export function setFocusedPanel(f: FocusedPanel | null) {
  current = f;
  listeners.forEach((l) => l(f));
}

export function getFocusedPanel(): FocusedPanel | null {
  return current;
}

export function subscribeFocusedPanel(l: (f: FocusedPanel | null) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True si obj está dentro del subárbol del panel enfocado. */
export function isUnderFocused(obj: THREE.Object3D | null | undefined): boolean {
  if (!current || !obj) return false;
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o === current.rootObj) return true;
    o = o.parent;
  }
  return false;
}

/** A2: estado de arrastre por rayo (header) — vive fuera de React para acceso por useFrame. */
export const rayDrag: { active: boolean; panelId: string | null; distance: number } = {
  active: false,
  panelId: null,
  distance: 1.5,
};
