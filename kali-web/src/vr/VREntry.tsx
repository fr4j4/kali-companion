/**
 * VREntry — default immersive environment ("Enter VR" lobby).
 *
 * Routes: /vr (lobby) and /vr/session/:sid (attach to a Kali session).
 *
 * Sala: grilla verde estilo matrix "infinita" (la grilla sigue al jugador
 * con snapping, la niebla oculta el borde), primitivas interactivas
 * (hover/select con el ray del control) y artefactos ui3d vivos de la
 * sesión flotando como paneles.
 *
 * Locomotion: stick izquierdo avanza/strafea (mueve el RIG, el parent de
 * la cámara — en WebXR mover camera.position no mueve al jugador);
 * stick derecho hace snap-turn de 30°.
 *
 * Menú de salida: panel anclado al controlador izquierdo que mira
 * siempre a la cabeza (lookAt) con botón SALIR seleccionable por ray.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { XR, Controllers, Hands, Interactive, useXR, RayGrab } from "@react-three/xr";
import { StageProvider, useStage } from "../stage/StageProvider";
import { AuthGate } from "../components/AuthGate";
import { fetchArtifact } from "../lib/artifacts";
import type { ArtifactEvent } from "../lib/protocol";
import { Ui3dSceneNodes, type Ui3dScene } from "../components/widgets/Ui3dWidget";
import { parseContent } from "../components/widgets/base/DataWidget";

/* ── WebXR plumbing ───────────────────────────────────────────── */

type VRSupport = "checking" | "supported" | "unsupported";

/** Ref module-level a la sesión XR activa (la leen locomotion/exit). */
const glXRSessionRef = { current: null as unknown };

function useVRSupport(): VRSupport {
  const [support, setSupport] = useState<VRSupport>("checking");
  useEffect(() => {
    const xr = (navigator as unknown as { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr;
    if (!xr?.isSessionSupported) {
      setSupport("unsupported");
      return;
    }
    let alive = true;
    xr.isSessionSupported("immersive-vr")
      .then((ok) => { if (alive) setSupport(ok ? "supported" : "unsupported"); })
      .catch(() => { if (alive) setSupport("unsupported"); });
    return () => { alive = false; };
  }, []);
  return support;
}

/** Bridges the r3f renderer to the DOM overlay button. */
function GLBridge({ glRef }: { glRef: React.MutableRefObject<unknown> }) {
  const { gl } = useThree();
  useEffect(() => {
    (gl as { xr: { enabled: boolean } }).xr.enabled = true;
    glRef.current = gl;
  }, [gl, glRef]);
  return null;
}

async function requestVRSession(gl: unknown): Promise<unknown> {
  const nav = navigator as unknown as { xr?: {
    requestSession: (m: string, init?: Record<string, unknown>) => Promise<unknown>;
  } };
  if (!nav.xr) throw new Error("WebXR no disponible en este navegador");
  const session = await nav.xr.requestSession("immersive-vr", {
    optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
  });
  const renderer = gl as {
    xr: {
      setReferenceSpaceType: (t: string) => void;
      setSession: (s: unknown) => Promise<unknown>;
    };
  };
  renderer.xr.setReferenceSpaceType("local-floor");
  await renderer.xr.setSession(session);
  return session;
}

/* ── player rig + locomotion ──────────────────────────────────── */

/**
 * Locomotion sobre el `player` group de @react-three/xr (v5): la librería
 * ya parenta la CÁMARA y los CONTROLLERS dentro de ese group, así que
 * mover `player` mueve TODO el conjunto (vista + manos + menú) — era la
 * causa del bug: mi rig propio y el player de la lib peleaban por la
 * cámara, y los controllers quedaban en coordenadas del reference space.
 */
function PlayerRig({
  children,
  onToggleMenu,
}: {
  children?: React.ReactNode;
  onToggleMenu?: () => void;
}) {
  const player = useXR((s) => s.player);
  const gl = useThree((s) => s.gl);
  const dir = useRef(new THREE.Vector3());
  const strafe = useRef(new THREE.Vector3());
  const snapArmed = useRef(true);
  const menuArmed = useRef(true);

  useFrame((_, delta) => {
    const session = glXRSessionRef.current as XRSession | null;
    if (!session || !player) return;

    let mx = 0; let my = 0; let tx = 0; let menuPressed = false;
    for (const source of session.inputSources) {
      if (!source.gamepad) continue;
      if (source.handedness === "left") {
        mx = source.gamepad.axes[2] ?? 0;
        my = source.gamepad.axes[3] ?? 0;
        // Quest: button 6 = botón de MENÚ (el pequeño, bajo X/Y).
        // button 4 = X y button 5 = Y — no son el de menú.
        menuPressed = Boolean(source.gamepad.buttons[6]?.pressed);
      } else if (source.handedness === "right") {
        tx = source.gamepad.axes[2] ?? 0;
      }
    }

    // Botón menú: alterna el panel (con rearme para un toggle por pulso).
    if (onToggleMenu && menuPressed && menuArmed.current) {
      onToggleMenu();
      menuArmed.current = false;
    } else if (!menuPressed) {
      menuArmed.current = true;
    }

    // Stick izq: avanzar/retroceder + strafe RELATIVO A LA MIRADA.
    // Fuente autoritativa: la cámara XR interna de three (la que
    // realmente renderiza — su matrixWorld es la pose de mundo del
    // visor compuesta con el player, actualizada en cada render).
    // transformDirection aplica solo la rotación, normalizada.
    if (Math.abs(mx) > 0.15 || Math.abs(my) > 0.15) {
      const xrCam = gl.xr.getCamera();
      dir.current.set(0, 0, -1).transformDirection(xrCam.matrixWorld);
      dir.current.y = 0;
      if (dir.current.lengthSq() < 1e-6) {
        // Mirando recto arriba/abajo: usa el norte del player.
        dir.current.set(0, 0, -1).applyQuaternion(player.quaternion);
        dir.current.y = 0;
      }
      dir.current.normalize();
      const speed = 2.4 * delta; // m/s — caminata cómoda
      player.position.addScaledVector(dir.current, -my * speed);
      strafe.current.set(-dir.current.z, 0, dir.current.x);
      player.position.addScaledVector(strafe.current, mx * speed);
    }

    // Stick der (X): snap-turn de 30° con rearme para no girar en ráfaga.
    if (snapArmed.current && Math.abs(tx) > 0.7) {
      player.rotateY(-Math.sign(tx) * Math.PI / 6);
      snapArmed.current = false;
    } else if (Math.abs(tx) < 0.4) {
      snapArmed.current = true;
    }
  });

  return <>{children}</>;
}

/* ── sala: grilla matrix infinita ─────────────────────────────── */

/** Celda de la grilla (size/divisions del gridHelper). */
const GRID_CELL = 2;

/** Grilla verde matrix que sigue al jugador con snapping (parece infinita). */
function MatrixFloor() {
  const camera = useThree((s) => s.camera);
  const grid = useRef<THREE.GridHelper>(null);
  const tmp = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!grid.current) return;
    camera.getWorldPosition(tmp.current);
    // Snap a celdas para que el patrón no "nade" bajo los pies.
    grid.current.position.set(
      Math.round(tmp.current.x / GRID_CELL) * GRID_CELL,
      0,
      Math.round(tmp.current.z / GRID_CELL) * GRID_CELL,
    );
  });

  return (
    <>
      <gridHelper
        ref={grid}
        args={[600, 600 / GRID_CELL, "#22c55e", "#0e3b28"]}
        position={[0, 0, 0]}
      />
      {/* piso sólido oscuro justo bajo la grilla */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#04070a" roughness={1} metalness={0} />
      </mesh>
    </>
  );
}

/* ── primitivas interactivas ──────────────────────────────────── */

type PrimKind = "box" | "sphere" | "torus" | "cone" | "cylinder";

function InteractivePrimitive({
  position, kind, color,
}: {
  position: [number, number, number];
  kind: PrimKind;
  color: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [on, setOn] = useState(false);
  const mesh = useRef<THREE.Mesh>(null);
  const targetScale = useRef(new THREE.Vector3(1, 1, 1));

  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.elapsedTime;
    // Flotación suave, desfasada por posición para que no bailen en bloque.
    mesh.current.position.y = position[1] + Math.sin(t * 1.1 + position[0] * 1.7) * 0.07;
    mesh.current.scale.lerp(targetScale.current, 0.18);
  });

  useEffect(() => {
    const s = hovered ? 1.2 : 1;
    targetScale.current.set(s, s, s);
  }, [hovered]);

  const base = on ? "#22c55e" : color;

  return (
    <Interactive
      onHover={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onSelect={() => setOn((o) => !o)}
    >
      <mesh ref={mesh} position={position}>
        {kind === "box" && <boxGeometry args={[0.8, 0.8, 0.8]} />}
        {kind === "sphere" && <sphereGeometry args={[0.45, 32, 32]} />}
        {kind === "torus" && <torusGeometry args={[0.38, 0.14, 16, 48]} />}
        {kind === "cone" && <coneGeometry args={[0.42, 0.9, 32]} />}
        {kind === "cylinder" && <cylinderGeometry args={[0.38, 0.38, 0.8, 32]} />}
        <meshStandardMaterial
          color={base}
          emissive={hovered ? base : "#000000"}
          emissiveIntensity={hovered ? 0.6 : 0}
          roughness={0.35}
          metalness={0.15}
        />
      </mesh>
    </Interactive>
  );
}

/** Arco de primitivas frente al spawn — todas agarrables con el ray. */
function InteractivePrimitives() {
  const items: Array<{ kind: PrimKind; color: string; x: number }> = [
    { kind: "box", color: "#38bdf8", x: -3 },
    { kind: "sphere", color: "#a78bfa", x: -1.5 },
    { kind: "torus", color: "#fbbf24", x: 0 },
    { kind: "cone", color: "#f472b6", x: 1.5 },
    { kind: "cylinder", color: "#fb7185", x: 3 },
  ];
  return (
    <>
      {items.map((it) => (
        <InteractivePrimitive
          key={it.kind}
          kind={it.kind}
          color={it.color}
          position={[it.x, 1.1, -3.2]}
        />
      ))}
    </>
  );
}

/* ── live ui3d artifacts → panels in the room ─────────────────── */

/** Parses an ArtifactEvent into a Ui3dScene (mirrors the widget path). */
function sceneFromEvent(ev: ArtifactEvent): Ui3dScene | null {
  if (ev.windowType !== "ui3d") return null;
  const { data } = parseContent(ev);
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!d.elements || typeof d.elements !== "object") return null;
  return d as unknown as Ui3dScene;
}

/** One floating panel per live ui3d artifact (fetches content on mount). */
function ScenePanel({ ev, index, sessionId }: { ev: ArtifactEvent; index: number; sessionId: string | null }) {
  const [scene, setScene] = useState<Ui3dScene | null>(() => sceneFromEvent(ev));

  useEffect(() => {
    const parsed = sceneFromEvent(ev);
    if (parsed) {
      setScene(parsed);
      return;
    }
    // Metadata-only replay: fetch full content via REST.
    if (!sessionId || !ev.id) {
      return;
    }
    let alive = true;
    fetchArtifact(sessionId, ev.id)
      .then((res) => {
        if (!alive) return;
        const asEvent = { ...ev, content: res.content } as ArtifactEvent;
        setScene(sceneFromEvent(asEvent));
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [ev, sessionId]);

  if (!scene) return null;

  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = (col - 1) * 2.6;
  const y = 1.9 - row * 1.5;
  const z = -6;

  return (
    <group position={[x, y, z]} scale={0.28}>
      <Ui3dSceneNodes scene={scene} />
    </group>
  );
}

function ArtifactPanels({ sessionId, live }: { sessionId: string | null; live: ArtifactEvent[] }) {
  return (
    <>
      {live.slice(0, 9).map((ev, i) => (
        <ScenePanel key={ev.id} ev={ev} index={i} sessionId={sessionId} />
      ))}
    </>
  );
}

/* ── wrist menu (menú de muñeca) ──────────────────────────────── */

/**
 * Menú estilo "wrist menu" VR: un reloj en la muñeca/antebrazo del
 * controlador izquierdo. No flota encima — está ANCLADO al grip y gira
 * con él, inmerso. Panel semitransparente con acciones reales de la UI:
 * Nueva sesión, Detener generación, cerrar menú y SALIR de VR.
 * Se abre/cierra con el botón de MENÚ físico del control izquierdo
 * (gamepad button 4 en Quest — no un trigger principal).
 */
function WristMenu({
  open,
  onExit,
  onClose,
  onOpenDebug,
}: {
  open: boolean;
  onExit: () => void;
  onClose: () => void;
  onOpenDebug: () => void;
}) {
  const controllers = useXR((s) => s.controllers);
  const camera = useThree((s) => s.camera);
  const left = controllers.find((c) => c.inputSource?.handedness === "left");
  const { chat } = useStage();
  const groupRef = useRef<THREE.Group>(null);
  const tmp = useRef({
    grip: new THREE.Vector3(),
    cam: new THREE.Vector3(),
    right: new THREE.Vector3(),
    camDir: new THREE.Vector3(),
  });

  // Posición: al costado DERECHO del control izquierdo (desde la vista
  // del usuario). Orientación: billboard hacia la cabeza (lookAt) — así
  // el texto siempre se lee correctamente, sin espejos.
  useFrame(() => {
    if (!left || !groupRef.current) return;
    // "Derecha del usuario": perpendicular a la vista, en el plano XZ.
    camera.getWorldDirection(tmp.current.camDir);
    tmp.current.right.set(-tmp.current.camDir.z, 0, tmp.current.camDir.x).normalize();
    left.grip.getWorldPosition(tmp.current.grip);
    camera.getWorldPosition(tmp.current.cam);
    const anchor = tmp.current.grip
      .clone()
      .addScaledVector(tmp.current.right, 0.14)
      .addScaledVector(tmp.current.camDir, -0.02)
      .add(new THREE.Vector3(0, 0.04, 0));
    groupRef.current.position.copy(anchor);
    groupRef.current.lookAt(tmp.current.cam);
  });

  if (!left || !open) return null;

  const label = (t: string) => (
    <Text
      fontSize={0.024}
      color="#e2e8f0"
      anchorX="center"
      anchorY="middle"
      maxWidth={0.2}
    >
      {t}
    </Text>
  );

  const item = (y: number, color: string, text: string, action: () => void) => (
    <Interactive onSelect={action}>
      <group position={[0, y, 0.001]}>
        <mesh>
          <planeGeometry args={[0.2, 0.052]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.35}
            depthWrite={false}
          />
        </mesh>
        <group position={[0, 0, 0.002]}>{label(text)}</group>
      </group>
    </Interactive>
  );

  return (
    <group ref={groupRef} scale={0.9}>
      {/* placa base semitransparente, inclinada hacia la cara */}
      <group rotation={[0.5, 0, 0]}>
        <mesh position={[0, 0.05, -0.005]}>
          <planeGeometry args={[0.23, 0.32]} />
          <meshBasicMaterial
            color="#0b0f14"
            transparent
            opacity={0.55}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>

        <group position={[0, 0.05, 0]}>
          {/* header */}
          <group position={[0, 0.125, 0.001]}>
            <Text fontSize={0.026} color="#38bdf8" anchorX="center" anchorY="middle">
              KALI VR
            </Text>
          </group>

          {/* acciones de la UI 2D */}
          {item(0.07, "#38bdf8", "Nueva sesión", () => chat.newSession())}
          {item(0.012, "#fbbf24", "Detener Kali", () => chat.stop())}
          {item(-0.046, "#a78bfa", "Panel debug", () => {
            onOpenDebug();
            onClose();
          })}
          {item(-0.105, "#94a3b8", "Cerrar menú", onClose)}

          {/* salir de VR */}
          {item(-0.105, "#fb7185", "Salir de VR", onExit)}
        </group>
      </group>
    </group>
  );
}

/** Sale de la sesión XR limpiamente (vuelve al lobby 2D). */
function useExitVR() {
  return useCallback(() => {
    const session = glXRSessionRef.current as { end?: () => Promise<void> } | null;
    if (session?.end) {
      session.end().catch(() => undefined);
    }
  }, []);
}

/** Panel de debug flotante: agarrable con el ray (RayGrab), botones en vivo. */
function DebugPanel({ onClose }: { onClose: () => void }) {
  const { chat } = useStage();
  const camera = useThree((s) => s.camera);
  const groupRef = useRef<THREE.Group>(null);
  const [placed, setPlaced] = useState(false);

  // Spawn frente al usuario (a 1.2 m) solo la primera vez; después queda
  // donde lo dejes (RayGrab toma el control del transform al arrastrar).
  useEffect(() => {
    if (placed || !groupRef.current) return;
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    groupRef.current.position.copy(camPos).addScaledVector(camDir, 1.2);
    groupRef.current.position.y = 1.4;
    groupRef.current.lookAt(camPos);
    setPlaced(true);
  }, [placed, camera]);

  const btn = (x: number, w: number, color: string, text: string, action: () => void) => (
    <Interactive onSelect={action}>
      <group position={[x, -0.09, 0.002]}>
        <mesh>
          <planeGeometry args={[w, 0.07]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} />
        </mesh>
        <group position={[0, 0, 0.002]}>
          <Text fontSize={0.028} color="#e2e8f0" anchorX="center" anchorY="middle">
            {text}
          </Text>
        </group>
      </group>
    </Interactive>
  );

  const status = chat.status === "ready" ? "conectado" : chat.status;
  const sess = chat.sessionId ? `${chat.sessionId.slice(0, 8)}…` : "—";
  const nArtifacts = chat.artifacts.size;

  return (
    <RayGrab>
      <group ref={groupRef}>
        {/* marco */}
        <mesh>
          <planeGeometry args={[0.56, 0.3]} />
          <meshBasicMaterial color="#0b0f14" transparent opacity={0.72} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        {/* header con título + cerrar */}
        <group position={[0, 0.115, 0.002]}>
          <Text fontSize={0.026} color="#22c55e" anchorX="center" anchorY="middle">
            {`DEBUG · ${status} · sesión ${sess} · ${nArtifacts} artifacts`}
          </Text>
        </group>
        {btn(-0.17, 0.16, "#38bdf8", "Nueva sesión", () => chat.newSession())}
        {btn(0.0, 0.14, "#fbbf24", "Detener", () => chat.stop())}
        {btn(0.185, 0.14, "#fb7185", "Cerrar", onClose)}
      </group>
    </RayGrab>
  );
}

/* ── room canvas ──────────────────────────────────────────────── */

/** Muestra en-VR el forward real de la cámara XR (diagnóstico locomotion). */
function VRDebugCompass() {
  const gl = useThree((s) => s.gl);
  const [info, setInfo] = useState({ yaw: 0, fx: 0, fz: 0 });

  useFrame(() => {
    const xrCam = gl.xr.getCamera();
    const f = new THREE.Vector3(0, 0, -1).transformDirection(xrCam.matrixWorld);
    const yaw = Math.atan2(-f.x, -f.z) * (180 / Math.PI);
    setInfo((prev) => {
      const next = { yaw: Math.round(yaw), fx: +f.x.toFixed(2), fz: +f.z.toFixed(2) };
      return prev.yaw === next.yaw && prev.fx === next.fx && prev.fz === next.fz ? prev : next;
    });
  });

  return (
    <group position={[0, 0.02, 1.6]} rotation={[-Math.PI / 2, 0, 0]}>
      <Text fontSize={0.28} color="#22c55e" anchorX="center" anchorY="middle">
        {`yaw ${info.yaw}°  fwd(${info.fx}, ${info.fz})`}
      </Text>
    </group>
  );
}

function RoomCanvas({ sessionId, live }: { sessionId: string | null; live: ArtifactEvent[] }) {
  const glRef = useRef<unknown>(null);
  const vrSupport = useVRSupport();
  const [vrError, setVrError] = useState("");
  const [vrBusy, setVrBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const exitVR = useExitVR();
  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);

  const enterVR = useCallback(async () => {
    setVrError("");
    setVrBusy(true);
    try {
      const session = await requestVRSession(glRef.current) as XRSession | undefined;
      if (session) {
        glXRSessionRef.current = session;
        session.addEventListener("end", () => {
          glXRSessionRef.current = null;
        });
      }
    } catch (e) {
      setVrError(e instanceof Error ? e.message : String(e));
    } finally {
      setVrBusy(false);
    }
  }, []);

  return (
    <div className="relative w-screen h-screen bg-[#0b0f14]">
      {vrSupport === "supported" && (
        <div className="absolute top-4 right-4 z-10">
          <button
            type="button"
            onClick={enterVR}
            disabled={vrBusy}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              vrBusy
                ? "border-muted/30 text-muted/50 cursor-wait"
                : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            {vrBusy ? "Conectando..." : "🥽 Entrar en VR"}
          </button>
          {vrError && (
            <div className="mt-2 max-w-64 text-xs text-warn/80">{vrError}</div>
          )}
        </div>
      )}

      <Canvas camera={{ position: [0, 1.6, 2], fov: 60 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={["#04070a"]} />
        <fog attach="fog" args={["#04070a", 10, 40]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 8, 4]} intensity={0.9} />
        <pointLight position={[0, 2.5, -2]} intensity={12} distance={9} color="#22c55e" />

        <XR>
          {/* Controllers/Hands/menú viven DENTRO del rig: heredan el
              transform del jugador y viajan con él al caminar/girar. */}
          <PlayerRig onToggleMenu={toggleMenu}>
            <Controllers />
            <Hands />
            <WristMenu
              open={menuOpen}
              onExit={exitVR}
              onClose={() => setMenuOpen(false)}
              onOpenDebug={() => setDebugOpen(true)}
            />
          </PlayerRig>
          {debugOpen && <DebugPanel onClose={() => setDebugOpen(false)} />}
          <MatrixFloor />
          <VRDebugCompass />
          <InteractivePrimitives />
          <Ui3dSceneNodes scene={liveRoomScene(live)} />
          <ArtifactPanels sessionId={sessionId} live={live} />
        </XR>

        <OrbitControls makeDefault target={[0, 1.2, -2]} maxPolarAngle={Math.PI / 2} />
        <GLBridge glRef={glRef} />
      </Canvas>

      <div className="absolute bottom-3 left-4 text-[11px] text-muted/50">
        {sessionId ? `sesión: ${sessionId.slice(0, 8)}…` : "sin sesión — abre /#/vr/session/<id> para acoplar una"}
      </div>
    </div>
  );
}

/** ui3d artifacts that are complete AND have full content in memory. */
function isLiveComplete(ev: ArtifactEvent): boolean {
  return ev.windowType === "ui3d" && ev.update !== "close" && ev.content != null;
}

/** Compact in-XR mirror of the live ui3d artifact count. */
function liveRoomScene(live: ArtifactEvent[]): Ui3dScene {
  const n = Math.min(live.length, 6);
  const elements: Ui3dScene["elements"] = {};
  const children: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `orb-${i}`;
    children.push(id);
    elements[id] = {
      type: "sphere",
      position: [
        Math.cos((i / Math.max(n, 1)) * Math.PI * 2) * 2.2,
        1.4 + (i % 2) * 0.4,
        Math.sin((i / Math.max(n, 1)) * Math.PI * 2) * 2.2,
      ],
      scale: 0.22,
      color: ["#38bdf8", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#fb7185"][i % 6],
    };
  }
  if (children.length === 0) return { elements: {} };
  elements.anillo = { type: "group", children };
  return { root: "anillo", elements };
}

/* ── inner app (inside StageProvider) ─────────────────────────── */

function VRLobbyInner() {
  const { chat } = useStage();
  const [fetched, setFetched] = useState<ArtifactEvent[]>([]);

  // Live artifacts with full content render directly.
  const live = useMemoLive(chat.artifacts);

  // On session attach: metadata-only replays need a REST fetch each.
  useEffect(() => {
    const sid = chat.sessionId;
    if (!sid) {
      setFetched([]);
      return;
    }
    let alive = true;
    const missing = [...chat.artifacts.values()].filter(
      (ev) => ev.windowType === "ui3d" && ev.content == null,
    );
    Promise.all(
      missing.map((ev) =>
        fetchArtifact(sid, ev.id)
          .then((res) => ({ ...ev, content: res.content }) as ArtifactEvent)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!alive) return;
      setFetched(results.filter((x): x is ArtifactEvent => x != null));
    });
    return () => { alive = false; };
  }, [chat.sessionId, chat.artifacts]);

  const panels = [...fetched, ...live];

  return <RoomCanvas sessionId={chat.sessionId} live={panels} />;
}

function useMemoLive(artifacts: Map<string, ArtifactEvent>): ArtifactEvent[] {
  return useMemo(() => [...artifacts.values()].filter(isLiveComplete), [artifacts]);
}

/* ── exported route component ─────────────────────────────────── */

export default function VREntry() {
  return (
    <StageProvider>
      <AuthGate />
      <VRLobbyInner />
    </StageProvider>
  );
}