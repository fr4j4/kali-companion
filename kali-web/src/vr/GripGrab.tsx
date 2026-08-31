import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useInteraction } from "@react-three/xr";
import * as THREE from "three";

/**
 * Grip + zoom — modelo definitivo (sin diagonales, sin inversiones, sin snaps).
 *
 * Mientras dura el grip, el panel queda pegado a un punto del espacio LOCAL del
 * control — su offset (en coordenadas del control) se captura al apretar el grip
 * y se recalcula cada frame al final, de modo que la ventana sigue tu mano 1:1.
 *
 * Stick derecho (Y):
 *   - Modifica la LONGITUD de grabOffsetLocal en su componente forward local del
 *     control (es decir, "lejos/cerca" respecto de la dirección a la que apunta
 *     tu control en ese momento, sin componente vertical para no salirse del
 *     plano horizontal).
 *   - Stick hacia abajo (raw<0) -> ALEJA (suma distancia).
 *   - Stick hacia arriba (raw>0) -> ACERCA (resta distancia).
 *   - Curva cuadrática suave, clamp 0.4..2.6 m.
 *
 * Soltar grip:
 *   - El polling físico del botón detecta release al instante (sin raycast).
 *   - El panel QUEDA EXACTAMENTE donde está el último frame: ni snap, ni
 *     re-orientación fantasma, ni "atado a la mano" residual.
 *
 * Multi-agarre: guard global __vrGrabbed — solo un panel agarrado a la vez.
 */
export function GripGrab({ children }: { children?: React.ReactNode }) {
  const grabbing = useRef<{ controller: THREE.Object3D; handedness: string } | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);

  // Offset del panel en el espacio LOCAL del control, capturado al apretar.
  const grabOffsetLocal = useRef(new THREE.Vector3(0, 0, -0.6));
  // Rotación relativa panel↔control, capturada al apretar.
  const grabQuatOffset = useRef(new THREE.Quaternion());

  const doRelease = () => {
    grabbing.current = null;
    (globalThis as { __vrGrabbed?: string | null }).__vrGrabbed = null;
  };

  useInteraction(groupRef, "onSqueezeStart", (e) => {
    const group = groupRef.current;
    if (!group) return;
    // anti multi-agarre: un panel a la vez
    if ((globalThis as { __vrGrabbed?: string | null }).__vrGrabbed) return;
    const ctrl = e.target.controller;
    const handedness =
      (e.target as { inputSource?: { handedness?: string } }).inputSource?.handedness ?? "right";
    (globalThis as { __vrGrabbed?: string | null }).__vrGrabbed = handedness;
    grabbing.current = { controller: ctrl, handedness };

    // Capturar offset panel→control en el espacio LOCAL del control.
    ctrl.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(ctrl.matrixWorld).invert();
    grabOffsetLocal.current.copy(group.position).applyMatrix4(inv);

    // Respetar clamp mínimo en el momento de agarre (no atravesar la mano).
    if (grabOffsetLocal.current.length() < 0.4) {
      grabOffsetLocal.current.normalize().multiplyScalar(0.4);
    }

    // Capturar rotación relativa panel↔control.
    grabQuatOffset.current
      .copy(ctrl.getWorldQuaternion(new THREE.Quaternion()).invert())
      .multiply(group.getWorldQuaternion(new THREE.Quaternion()));
  });

  useInteraction(groupRef, "onSqueezeEnd", () => {
    if (grabbing.current) doRelease();
  });

  // Cleanup si el panel se desmonta mientras está agarrado.
  useEffect(
    () => () => {
      if (grabbing.current) doRelease();
    },
    [],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    const g = grabbing.current;
    if (!group || !g) return;
    const ctrl = g.controller;
    ctrl.updateMatrixWorld();

    // ── POLLING físico del grip — solo buttons[1], el trigger es para clicks ──
    const session = gl.xr.getSession?.();
    if (!session) return;
    let gripDown = false;
    for (const src of session.inputSources) {
      if (src.handedness !== g.handedness || !src.gamepad) continue;
      gripDown = src.gamepad.buttons[1]?.pressed ?? false;
      if (gripDown) break;
    }
    if (!gripDown) {
      doRelease();
      return;
    }

    // ── Stick derecho: ZOOM modificando la Z local del offset (recto, sin diagonales) ──
    let zoomInput = 0; // -1..+1, + = alejar, - = acercar
    for (const src of session.inputSources) {
      if (src.handedness !== "right" || !src.gamepad) continue;
      const axes = src.gamepad.axes;
      // axes[1] = Y del stick principal (estándar Quest). Si no, fallback axes[3].
      const raw = axes[1] ?? axes[3] ?? 0;
      const dz = 0.25;
      if (Math.abs(raw) > dz) {
        const norm = (Math.abs(raw) - dz) / (1 - dz);
        // Convención: raw<0 cuando se empuja el stick HACIA ARRIBA en el mando.
        // Sentido NATURAL: stick arriba (raw<0) = ACERCAR => zoomInput NEGATIVO.
        zoomInput = Math.sign(-raw) * norm * norm; // cuadrática suave, máx 1
      }
    }
    if (zoomInput !== 0) {
      // El "frente" del control en coords locales es -Z. La Z local del offset
      // es grabOffsetLocal.z. Modificamos su MAGNITUD proyectando sobre la
      // dirección forward del control, SIN componente vertical (no diagonales).
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
        ctrl.getWorldQuaternion(new THREE.Quaternion()),
      );
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();

      // Dirección actual panel→control (también horizontal) — para que el zoom
      // se aplique SOBRE la línea visible mano→panel (no fuerces la dirección).
      const ctrlPos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
      ctrlPos.y = group.position.y; // forzar plano horizontal
      const toPanel = group.position.clone().sub(ctrlPos);
      const horizLen = Math.hypot(toPanel.x, toPanel.z);
      const dir =
        horizLen > 1e-3
          ? new THREE.Vector3(toPanel.x / horizLen, 0, toPanel.z / horizLen)
          : fwd;

      // Distancia objetivo: partimos de la distancia horizontal actual y la
      // variamos con el stick (cuadrática suave, máx 1 m/s).
      const speed = 1.0;
      const targetDist = Math.min(
        Math.max(horizLen + zoomInput * speed * delta, 0.4),
        2.6,
      );

      // Reconstruir la posición objetivo sobre esa línea horizontal.
      group.position.copy(ctrlPos).addScaledVector(dir, targetDist);

      // Re-proyectar la nueva posición al espacio LOCAL del control para que el
      // drag siga siendo coherente tras el zoom.
      const inv = new THREE.Matrix4().copy(ctrl.matrixWorld).invert();
      grabOffsetLocal.current.copy(group.position).applyMatrix4(inv);
    }

    // ── DRAG 1:1 con offset vivo (al final de todo, manda el offset actualizado) ──
    group.position.copy(grabOffsetLocal.current).applyMatrix4(ctrl.matrixWorld);
    group.quaternion
      .copy(ctrl.getWorldQuaternion(new THREE.Quaternion()))
      .multiply(grabQuatOffset.current);
    group.updateMatrixWorld();
  });

  return <group ref={groupRef}>{children}</group>;
}
