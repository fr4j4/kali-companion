import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR, useXREvent } from "@react-three/xr";
import { createRayPointer, type Pointer as PEPointer } from "@pmndrs/pointer-events";
import { getFocusedPanel, isUnderFocused } from "./panelFocus";

/**
 * Puente XR v5 -> @pmndrs/pointer-events:
 * convierte el rayo de cada controlador en pointer events reales
 * (pointerMove/Down/Up/Over/Out) para que uikit reciba onClick,
 * hover y scroll en el HMD.
 */
/** API global para disparar scroll sintético por el rayo del control derecho. */
export const xrWheel = {
  scene: null as THREE.Scene | null,
  pointers: null as Map<THREE.Object3D, PEPointer> | null,
};

export function XrPointerBridge() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controllers = useXR((s) => s.controllers);

  const pointers = useMemo(() => {
    const map = new Map<THREE.Object3D, PEPointer>();
    xrWheel.pointers = map;
    return map;
  }, []);
  useEffect(() => {
    xrWheel.scene = scene;
    return () => { xrWheel.scene = null; xrWheel.pointers = null; };
  }, [scene]);

  useEffect(() => {
    return () => {
      // cleanup al desmontar
      pointers.forEach((p) => {
        try { p.exit({ pointerId: 0, pointerType: "xr" } as never); } catch { /* noop */ }
      });
      pointers.clear();
    };
  }, [pointers]);

  // Última dirección de scroll por mano (para tasa fija por frame)
  const lastWheel = useRef({ right: 0, left: 0 });

  useFrame((_, delta) => {
    if (!controllers?.length) return;
    const session = xrWheelSceneSession();
    for (const controller of controllers) {
      if (!controller?.inputSource?.handedness) continue;
      const hand = controller.inputSource.handedness;
      let ptr = pointers.get(controller.controller);
      if (!ptr) {
        ptr = createRayPointer(
          () => camera,
          { current: controller.controller },
          { pointerId: hand === "left" ? 101 : 102 },
        );
        pointers.set(controller.controller, ptr);
      }
      // move cada frame: hover + scroll position updates
      try {
        ptr.move(scene, {
          pointerId: hand === "left" ? 101 : 102,
          pointerType: hand,
          pointerState: controller.inputSource,
        } as never);
      } catch { /* noop */ }

      // ── scroll por thumbstick SOLO si el rayo apunta al panel enfocado ──
      const focused = getFocusedPanel();
      if (!focused || !xrWheel.scene || !session) continue;
      const gp = controller.inputSource.gamepad;
      if (!gp) continue;
      // el hit actual del rayo debe pertenecer al panel enfocado
      const hit = ptr.getIntersection?.();
      if (!hit || !isUnderFocused(hit.object)) continue;
      const axes = gp.axes;
      const y = axes[3] ?? axes[1] ?? 0;
      const x = axes[2] ?? axes[0] ?? 0;
      const dz = 0.25;
      // rayo del control debe intersectar el panel enfocado — aproximación:
      // el propio pointer tiene intersección actual; si su objeto no pertenece al panel, skip.
      // Simplificación pragmática: solo aplicamos wheel si el pointer intersectó algo esta frame
      // y la sesión está activa. El foco decide qué panel es, y uikit enruta el wheel al container bajo el rayo.
      let wheelY = 0, wheelX = 0;
      if (Math.abs(y) > dz) {
        const norm = (Math.abs(y) - dz) / (1 - dz);
        wheelY = -Math.sign(y) * norm * norm * (hand === "right" ? 600 : 240) * delta; // px/seg
      }
      if (Math.abs(x) > dz) {
        const norm = (Math.abs(x) - dz) / (1 - dz);
        wheelX = Math.sign(x) * norm * norm * (hand === "right" ? 600 : 240) * delta;
      }
      if (wheelY === 0 && wheelX === 0) {
        if (hand === "right") lastWheel.current.right = 0;
        else lastWheel.current.left = 0;
        continue;
      }
      // evitar duplicar wheel cada sub-frame: acumular y emitir como wheel continuo
      try {
        ptr.wheel(xrWheel.scene, {
          pointerId: hand === "left" ? 101 : 102,
          pointerType: hand,
          pointerState: controller.inputSource,
          deltaX: wheelX,
          deltaY: wheelY,
          deltaZ: 0,
        } as never);
      } catch { /* noop */ }
    }
  });

  // helper: sesión activa (evita recrear closures por frame)
  function xrWheelSceneSession(): XRSession | null {
    return gl.xr.getSession?.() ?? null;
  }

  // select -> down/up
  useXREvent("selectstart", (e) => {
    const target = e.target as { controller?: THREE.Object3D; inputSource?: { handedness?: string } | null };
    const ptr = pointers.get(target.controller!);
    if (!ptr || !target.inputSource?.handedness) return;
    try {
      ptr.down({
        pointerId: target.inputSource.handedness === "left" ? 101 : 102,
        pointerType: target.inputSource.handedness,
        pointerState: target.inputSource,
        button: 0,
        timeStamp: performance.now(),
      } as never);
    } catch { /* noop */ }
  });

  useXREvent("selectend", (e) => {
    const target = e.target as { controller?: THREE.Object3D; inputSource?: { handedness?: string } | null };
    const ptr = pointers.get(target.controller!);
    if (!ptr || !target.inputSource?.handedness) return;
    try {
      ptr.up({
        pointerId: target.inputSource.handedness === "left" ? 101 : 102,
        pointerType: target.inputSource.handedness,
        pointerState: target.inputSource,
        button: 0,
        timeStamp: performance.now(),
      } as never);
    } catch { /* noop */ }
  });

  return null;
}
