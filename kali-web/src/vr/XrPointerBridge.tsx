import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR, useXREvent } from "@react-three/xr";
import { createRayPointer, type Pointer as PEPointer } from "@pmndrs/pointer-events";

/**
 * Puente XR v5 -> @pmndrs/pointer-events:
 * convierte el rayo de cada controlador en pointer events reales
 * (pointerMove/Down/Up/Over/Out) para que uikit reciba onClick,
 * hover y scroll en el HMD.
 */
export function XrPointerBridge() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controllers = useXR((s) => s.controllers);

  const pointers = useMemo(() => {
    const map = new Map<THREE.Object3D, PEPointer>();
    return map;
  }, []);

  useEffect(() => {
    return () => {
      // cleanup al desmontar
      pointers.forEach((p) => {
        try { p.exit({ pointerId: 0, pointerType: "xr" } as never); } catch { /* noop */ }
      });
      pointers.clear();
    };
  }, [pointers]);

  useFrame(() => {
    if (!controllers?.length) return;
    for (const controller of controllers) {
      if (!controller?.inputSource?.handedness) continue;
      let ptr = pointers.get(controller.controller);
      if (!ptr) {
        ptr = createRayPointer(
          () => camera,
          { current: controller.controller },
          { pointerId: controller.inputSource.handedness === "left" ? 101 : 102 },
        );
        pointers.set(controller.controller, ptr);
      }
      // move cada frame: hover + scroll position updates
      try {
        ptr.move(scene, {
          pointerId: controller.inputSource.handedness === "left" ? 101 : 102,
          pointerType: controller.inputSource.handedness,
          pointerState: controller.inputSource,
        } as never);
      } catch { /* noop */ }
    }
  });

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
