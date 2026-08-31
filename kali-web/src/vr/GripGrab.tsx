import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useInteraction } from "@react-three/xr";
import * as THREE from "three";

/**
 * Grip + zoom — modelo simple y correcto.
 *
 * AGARRAR (squeezeStart):
 *   1) Capturar la DISTANCIA horizontal actual entre control y panel.
 *   2) Capturar la DIRECCIÓN horizontal actual (panel - control), normalizada.
 *
 * MIENTRAS DURA EL GRIP (cada frame):
 *   - Calcular la nueva posición del panel:
 *       nuevaDist = clamp(distActual + zoomInput * speed * delta, MIN, MAX)
 *       group.position = controlPosXZ + dir * nuevaDist
 *       group.quaternion = ctrl.quat * grabQuatOffset
 *
 *     donde zoomInput viene del stick derecho:
 *       stick arriba (raw<0) => zoomInput < 0 => ACERCA (reduce dist)
 *       stick abajo (raw>0) => zoomInput > 0 => ALEJA (aumenta dist)
 *
 *   - Si el stick está en deadzone, zoomInput=0 => la distancia se mantiene
 *     exactamente, sin deriva, sin acumulación. Mover la mano simplemente
 *     arrastra la ventana porque controlPosXZ cambia (drag 1:1 natural).
 *
 * SOLTAR (squeezeEnd o polling físico buttons[1]=false):
 *   - El panel queda EXACTAMENTE donde el último frame lo dejó. Sin snap,
 *     sin re-orientación. Limpieza del guard global.
 *
 * Por qué este modelo es correcto:
 *   - El zoom modifica directamente `group.position` cada frame, sin pasar
 *     por offsets locales intermedios que se re-proyectan mal.
 *   - La dirección se congela al AGARRAR y se reusa mientras dura el grip
 *     (no se recalcula cada frame — eso era la fuente de los movimientos
 *     diagonales: si el frame siguiente recalculabas con un nuevo controlPosXZ,
 *     el panel se desviaba de la línea recta).
 *   - El drag 1:1 es consecuencia natural: si zoomInput=0 y tu mano se mueve,
 *     controlPosXZ cambia, la fórmula `controlPosXZ + dir*dist` mueve el panel
 *     en la misma dirección y distancia que tu mano.
 */
export function GripGrab({ children }: { children?: React.ReactNode }) {
  const grabbing = useRef<{
    controller: THREE.Object3D;
    handedness: string;
    /** Dirección horizontal congelada al agarrar (panel - control), normalizada en XZ. */
    dir: THREE.Vector3;
    /** Distancia horizontal al agarrar (clamp MIN..MAX). */
    dist: number;
    /** Rotación relativa panel↔control capturada al agarrar. */
    quatOffset: THREE.Quaternion;
  } | null>(null);

  const groupRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);

  const MIN_DIST = 0.5;
  const MAX_DIST = 3.0;
  const SPEED = 1.2; // m/s al máximo del stick

  const doRelease = () => {
    grabbing.current = null;
    (globalThis as { __vrGrabbed?: string | null }).__vrGrabbed = null;
  };

  useInteraction(groupRef, "onSqueezeStart", (e) => {
    const group = groupRef.current;
    if (!group) return;
    // anti multi-agarre
    if ((globalThis as { __vrGrabbed?: string | null }).__vrGrabbed) return;

    const ctrl = e.target.controller;
    const handedness =
      (e.target as { inputSource?: { handedness?: string } }).inputSource?.handedness ?? "right";
    (globalThis as { __vrGrabbed?: string | null }).__vrGrabbed = handedness;

    ctrl.updateMatrixWorld();
    const ctrlPos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
    const toPanel = group.position.clone().sub(ctrlPos);
    // Aplanar a XZ para que el zoom nunca vaya hacia arriba/abajo.
    toPanel.y = 0;
    let dist = toPanel.length();
    let dir = new THREE.Vector3();
    if (dist < 1e-3) {
      // El panel está exactamente encima del control — usar el forward del control como fallback.
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
        ctrl.getWorldQuaternion(new THREE.Quaternion()),
      );
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      dir.copy(fwd);
      dist = Math.max(MIN_DIST, 0.6);
    } else {
      dir.copy(toPanel).divideScalar(dist);
      // Respetar clamp de distancia al agarrar (no atravesar la mano).
      dist = Math.min(Math.max(dist, MIN_DIST), MAX_DIST);
    }

    const quatOffset = ctrl
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(group.getWorldQuaternion(new THREE.Quaternion()));

    grabbing.current = { controller: ctrl, handedness, dir, dist, quatOffset };
  });

  useInteraction(groupRef, "onSqueezeEnd", () => {
    if (grabbing.current) doRelease();
  });

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

    // ── Stick derecho: zoom sobre la dirección congelada ──
    let zoomInput = 0;
    for (const src of session.inputSources) {
      if (src.handedness !== "right" || !src.gamepad) continue;
      const axes = src.gamepad.axes;
      // En Quest: axes[1] = Y del stick principal (estándar WebXR).
      const raw = axes[1] ?? axes[3] ?? 0;
      const dz = 0.18;
      if (Math.abs(raw) > dz) {
        const norm = (Math.abs(raw) - dz) / (1 - dz);
        // raw<0 = stick ARRIBA. Sentido natural: ARRIBA ACERCA => zoomInput NEGATIVO.
        zoomInput = Math.sign(-raw) * norm * norm;
      }
    }

    // Integrar la distancia con el stick (cuadrática suave).
    if (zoomInput !== 0) {
      g.dist = Math.min(
        Math.max(g.dist + zoomInput * SPEED * delta, MIN_DIST),
        MAX_DIST,
      );
    }

    // ── Posicionar el panel ──
    // controlPosXZ (sin componente vertical para mantener el panel a la altura del control)
    const ctrlPos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
    group.position.set(
      ctrlPos.x + g.dir.x * g.dist,
      group.position.y, // conservar altura actual del panel (no subir/bajar con la mano)
      ctrlPos.z + g.dir.z * g.dist,
    );
    group.quaternion
      .copy(ctrl.getWorldQuaternion(new THREE.Quaternion()))
      .multiply(g.quatOffset);
    group.updateMatrixWorld();
  });

  return <group ref={groupRef}>{children}</group>;
}
