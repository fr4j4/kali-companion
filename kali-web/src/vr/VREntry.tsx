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
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Html } from "@react-three/drei";
import { XR, Controllers, Hands, Interactive, useXR, useInteraction } from "@react-three/xr";
import { widgetRegistry } from "../components/widgets/widgetRegistry";
import type { WindowType } from "../workspace/types";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { VrWidgetRenderer } from "./widgets/VrWidgetRenderer";
import { Root, Container, Text as UIKitText } from "@react-three/uikit";
import { useVrFont } from "./useVrFont";
import { XrPointerBridge } from "./XrPointerBridge";
import { VrMiniCard, TYPE_COLORS } from "./VrMiniCard";
import { setFocusedPanel, subscribeFocusedPanel, rayDrag } from "./panelFocus";
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
  // dom-overlay: hace visible el DOM (inputs de chat de drei <Html>)
  // durante la sesión inmersiva — sin él, el input de chat es invisible.
  const session = await nav.xr.requestSession("immersive-vr", {
    optionalFeatures: [
      "local-floor", "bounded-floor", "hand-tracking", "layers", "dom-overlay",
    ],
    domOverlay: { root: document.body },
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
  onToggleX,
}: {
  children?: React.ReactNode;
  onToggleMenu?: () => void;
  onToggleX?: () => void;
}) {
  const player = useXR((s) => s.player);
  const gl = useThree((s) => s.gl);
  const dir = useRef(new THREE.Vector3());
  const strafe = useRef(new THREE.Vector3());
  const snapArmed = useRef(true);
  const menuArmed = useRef(true);
  const menuArmedX = useRef(true);

  useFrame((_, delta) => {
    const session = glXRSessionRef.current as XRSession | null;
    if (!session || !player) return;

    let mx = 0; let my = 0; let tx = 0;
    let source4 = false; let source5 = false;
    for (const source of session.inputSources) {
      if (!source.gamepad) continue;
      if (source.handedness === "left") {
        mx = source.gamepad.axes[2] ?? 0;
        my = source.gamepad.axes[3] ?? 0;
        // xr-standard en Quest: 4=X, 5=Y. El botón físico de menú está
        // reservado por el OS y nunca llega al gamepad (§3.4 W3C).
        source4 = Boolean(source.gamepad.buttons[4]?.pressed);
        source5 = Boolean(source.gamepad.buttons[5]?.pressed);
      } else if (source.handedness === "right") {
        tx = source.gamepad.axes[2] ?? 0;
      }
    }

    // Toggle wrist menu con Y (button 5) — rearme anti-ráfaga.
    if (onToggleMenu && source5 && menuArmed.current) {
      onToggleMenu();
      menuArmed.current = false;
    } else if (!source5) {
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

    // Botones del control IZQUIERDO:
    //   Y (5) → wrist menu · X (4) → panel de comandos
    //   (el botón físico de menú está reservado por el OS de Quest y
    //   nunca llega al gamepad — W3C WebXR Gamepads §3.4)
    // X (4) → panel de comandos (toggle, rearme propio)
    if (onToggleX && source4 && menuArmedX.current) {
      onToggleX();
      menuArmedX.current = false;
    } else if (!source4) {
      menuArmedX.current = true;
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

/* ── audio UX + feedback ──────────────────────────────────────── */

/** Sonidos de interacción vía WebAudio (sin assets externos). */
function useUISounds() {
  const ctxRef = useRef<AudioContext | null>(null);

  return useMemo(() => {
    const ensure = (): AudioContext | null => {
      if (typeof window === "undefined") return null;
      if (!ctxRef.current) {
        const Ctor = window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctxRef.current = new Ctor();
      }
      if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
      return ctxRef.current;
    };
    const blip = (freq: number, dur = 0.06, vol = 0.05, type: OscillatorType = "sine") => {
      const ctx = ensure();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    };
    return {
      hover: () => blip(880, 0.03, 0.02),
      select: () => { blip(660, 0.05, 0.05); setTimeout(() => blip(990, 0.07, 0.05), 45); },
      open: () => blip(520, 0.05, 0.04, "triangle"),
      close: () => blip(340, 0.05, 0.04, "triangle"),
      rec: () => blip(1100, 0.09, 0.06, "square"),
    };
  }, []);
}

/** Item de menú con feedback visual (hover: brillo+escala) + sonido. */
function MenuItem({
  x = 0, y, w, color, text, sound, onSelect, onHover,
}: {
  x?: number;
  y: number;
  w: number;
  color: string;
  text: string;
  sound: { hover: () => void; select: () => void };
  onSelect: () => void;
  onHover?: (h: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Interactive
      onHover={() => { setHovered(true); sound.hover(); onHover?.(true); }}
      onBlur={() => { setHovered(false); onHover?.(false); }}
      onSelect={() => { sound.select(); onSelect(); }}
    >
      <group position={[x, y, 0.001]} scale={hovered ? 1.06 : 1}>
        <mesh>
          <planeGeometry args={[w, 0.042]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={hovered ? 0.75 : 0.3}
            depthWrite={false}
          />
        </mesh>
        <group position={[0, 0, 0.002]}>
          <Text fontSize={0.017} color={hovered ? "#ffffff" : "#cbd5e1"} anchorX="center" anchorY="middle" maxWidth={w - 0.01}>
            {text}
          </Text>
        </group>
      </group>
    </Interactive>
  );
}

/* ── wrist menu (menú de muñeca) ──────────────────────────────── */

/**
 * Menú compacto anclado al costado derecho del control izquierdo,
 * billboard hacia la cara, semitransparente. Toggle con botón Y.
 * Acciones: Nueva sesión, Detener, Panel debug, Comandos (voz/chat),
 * Cerrar y Salir de VR — con feedback visual y sonoro.
 */
function WristMenu({
  open,
  onExit,
  onClose,
  onOpenDebug,
  onOpenCommands,
}: {
  open: boolean;
  onExit: () => void;
  onClose: () => void;
  onOpenDebug: () => void;
  onOpenCommands: () => void;
}) {
  const controllers = useXR((s) => s.controllers);
  const camera = useThree((s) => s.camera);
  const left = controllers.find((c) => c.inputSource?.handedness === "left");
  const { chat } = useStage();
  const sound = useUISounds();
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

  useEffect(() => {
    if (open) sound.open();
  }, [open, sound]);

  if (!left || !open) return null;

  return (
    <group ref={groupRef} scale={0.9}>
      <group rotation={[0.35, 0, 0]}>
        {/* placa base compacta — 5 ítems de 0.042 + header, sin solapes */}
        <mesh position={[0, 0.02, -0.004]}>
          <planeGeometry args={[0.21, 0.27]} />
          <meshBasicMaterial
            color="#0b0f14"
            transparent
            opacity={0.55}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>

        <group position={[0, 0.02, 0]}>
          <group position={[0, 0.108, 0.001]}>
            <Text fontSize={0.019} color="#38bdf8" anchorX="center" anchorY="middle">
              KALI VR
            </Text>
          </group>

          <MenuItem y={0.068} w={0.19} color="#38bdf8" text="Nueva sesión" sound={sound} onSelect={() => chat.newSession()} />
          <MenuItem y={0.024} w={0.19} color="#fbbf24" text="Detener Kali" sound={sound} onSelect={() => chat.stop()} />
          <MenuItem y={-0.02} w={0.19} color="#a78bfa" text="Panel debug" sound={sound} onSelect={() => { onOpenDebug(); onClose(); }} />
          <MenuItem y={-0.064} w={0.19} color="#34d399" text="Comandos" sound={sound} onSelect={() => { onOpenCommands(); onClose(); }} />
          <MenuItem y={-0.108} w={0.19} color="#fb7185" text="Salir de VR" sound={sound} onSelect={onExit} />
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

/** Panel de debug flotante: launchers de ejemplo para cada WindowType + controles. */
function DebugPanel({ onClose, onOpenArtifact }: { onClose: () => void; onOpenArtifact: (id: string) => void }) {
  const { chat } = useStage();
  const camera = useThree((s) => s.camera);
  const groupRef = useRef<THREE.Group>(null);
  const [placed, setPlaced] = useState(false);
  const sound = useUISounds();

  useEffect(() => {
    if (placed || !groupRef.current) return;
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    groupRef.current.position.copy(camPos).addScaledVector(camDir, 1.4);
    groupRef.current.position.y = 1.35;
    groupRef.current.lookAt(camPos);
    setPlaced(true);
  }, [placed, camera]);

  const status = chat.status === "ready" ? "conectado" : chat.status;
  const sess = chat.sessionId ? `${chat.sessionId.slice(0, 8)}…` : "—";
  const nArtifacts = chat.artifacts.size;

  const inject = (windowType: string, title: string, content: string) => {
    const id = `debug_${windowType}_${Math.random().toString(36).slice(2, 8)}`;
    const ev = { event: "artifact" as const, id, type: "widget" as const, windowType, title, content, update: "create" as const, phase: "complete" as const };
    chat.setArtifactContent(id, ev as unknown as import("../lib/protocol").ArtifactEvent);
    sound.select();
    // auto-spawn en el mundo para verlo de inmediato
    onOpenArtifact(id);
  };

  const samples: Array<{ wt: string; label: string; color: string; make: () => [string, string] }> = [
    { wt: "html", label: "html", color: "#f59e0b", make: () => ["Tienda Kali VR", `<div style="font-family:sans-serif;background:#f8fafc;color:#111"><header style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;padding:16px;display:flex;justify-content:space-between;align-items:center"><h1 style="margin:0;font-size:20px">Tienda Kali VR</h1><span style="font-size:12px;opacity:.85">demo interactiva</span></header><nav style="display:flex;gap:8px;padding:10px 16px;background:#0b0f14"><button style="flex:1;padding:10px;background:#1e293b;color:#38bdf8;border:none;border-radius:8px;font-size:13px;font-weight:bold">Inicio</button><button style="flex:1;padding:10px;background:#1e293b;color:#38bdf8;border:none;border-radius:8px;font-size:13px;font-weight:bold">Catalogo</button><button style="flex:1;padding:10px;background:#1e293b;color:#38bdf8;border:none;border-radius:8px;font-size:13px;font-weight:bold">Carrito (2)</button><button style="flex:1;padding:10px;background:#1e293b;color:#38bdf8;border:none;border-radius:8px;font-size:13px;font-weight:bold">Mi cuenta</button></nav><main style="padding:16px"><p style="font-size:14px;line-height:1.5;margin:0 0 12px">Bienvenido <b>Yami</b> — tienes <b style="color:#22c55e">2 productos</b> en el carrito. Toca los botones con el trigger.</p><div style="background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h2 style="margin:0 0 8px;font-size:15px;color:#0ea5e9">Casco Meta Quest 3</h2><p style="margin:0 0 10px;font-size:12px;color:#475569">128GB — 4152 x 2208 por ojo, 120Hz, pancake lenses.</p><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:18px;font-weight:bold;color:#22c55e">$499</span><span><button style="padding:8px 12px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;margin-right:6px">-</button><b style="padding:0 8px">1</b><button style="padding:8px 12px;background:#22c55e;color:#fff;border:none;border-radius:6px;font-size:12px">+</button></span></div></div><div style="background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><h2 style="margin:0 0 8px;font-size:15px;color:#0ea5e9">Batería externa</h2><p style="margin:0 0 10px;font-size:12px;color:#475569">5000 mAh — 2h extra de juego.</p><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:18px;font-weight:bold;color:#22c55e">$89</span><span><button style="padding:8px 12px;background:#ef4444;color:#fff;border:none;border-radius:6px;font-size:12px;margin-right:6px">-</button><b style="padding:0 8px">1</b><button style="padding:8px 12px;background:#22c55e;color:#fff;border:none;border-radius:6px;font-size:12px">+</button></span></div></div><details style="background:#fff;border-radius:10px;padding:12px;margin-bottom:12px"><summary style="font-weight:bold;font-size:13px;cursor:pointer">Envío y garantía (acordeón)</summary><p style="font-size:12px;color:#475569;padding-top:8px;margin:0">Envío gratis a todo Chile en compras sobre $50. Garantía de 12 meses contra defectos de fábrica.</p></details><div style="background:#0b0f14;border-radius:10px;padding:14px"><div style="display:flex;justify-content:space-between;margin-bottom:10px"><span style="color:#94a3b8;font-size:13px">Total</span><span style="color:#22c55e;font-size:18px;font-weight:bold">$588</span></div><button style="width:100%;padding:12px;background:linear-gradient(90deg,#22c55e,#10b981);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:bold">Pagar ahora</button></div><form style="margin-top:12px;display:flex;gap:8px"><input placeholder="Cupón de descuento" style="flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px" /><button style="padding:10px 16px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:bold">Aplicar</button></form></main><footer style="padding:12px 16px;background:#e2e8f0;color:#64748b;font-size:11px;text-align:center">Kali VR · scroll con thumbstick sobre el panel · grip para mover</footer><div style="padding:0 16px 16px;background:#f8fafc"><p style="font-size:11px;color:#94a3b9;margin:4px 0">Extra 1 — contenido de relleno para scroll.</p><p style="font-size:11px;color:#94a3b9;margin:4px 0">Extra 2 — más texto para bajar con el thumbstick.</p><p style="font-size:11px;color:#94a3b9;margin:4px 0">Extra 3 — último párrafo del demo.</p><p style="font-size:11px;color:#94a3b9;margin:4px 0">Extra 4 — ¿llegaste al final? El scroll funciona.</p></div></div>`] },
    { wt: "document", label: "doc", color: "#38bdf8", make: () => ["Doc MD", "# Guía Kali VR — tildes áéíóú ñ ü ¿cómo estás?\n\nEste **documento** prueba el render markdown en VR.\n\n- Punto 1: fidelidad 1:1\n- Punto 2: paginado\n\n> Cita de ejemplo\n\n`código inline`"] },
    { wt: "code", label: "code", color: "#a78bfa", make: () => ["Código", "function holaVR() {\n  console.log('Kali en VR — fidelidad 1:1');\n  return 42;\n}\nholaVR();"] },
    { wt: "json", label: "json", color: "#fbbf24", make: () => ["JSON", JSON.stringify({ name: "Kali", version: 2, vr: true, items: [1,2,3], nested: { a: 1 } }, null, 2)] },
    { wt: "table", label: "table", color: "#22d3ee", make: () => ["Inventario", JSON.stringify({ rows: [ { producto: "Quest 3", stock: 5, precio: 499, estado: "disponible" }, { producto: "Quest 2", stock: 0, precio: 249, estado: "agotado" }, { producto: "Valve Index", stock: 2, precio: 999, estado: "disponible" }, { producto: "Pico 4", stock: 8, precio: 429, estado: "disponible" }, { producto: "PSVR2", stock: 3, precio: 549, estado: "bajo stock" } ] })] },
    { wt: "checklist", label: "check", color: "#34d399", make: () => ["Checklist", JSON.stringify({ items: [ { text: "Descargar kali-companion", done: true }, { text: "Configurar Docker y TLS", done: true }, { text: "Probar artefactos en VR", done: true }, { text: "Verificar tildes en el panel", done: true }, { text: "Probar botones con trigger", done: false }, { text: "Ajustar distancia con thumbstick", done: false } ] })] },
    { wt: "chart", label: "chart", color: "#22d3ee", make: () => ["Ventas VR 2026", JSON.stringify({ rows: [ { mes: "Enero", ventas: 12 }, { mes: "Febrero", ventas: 19 }, { mes: "Marzo", ventas: 8 }, { mes: "Abril", ventas: 24 }, { mes: "Mayo", ventas: 31 }, { mes: "Junio", ventas: 27 } ] })] },
    { wt: "mermaid", label: "mermaid", color: "#a78bfa", make: () => ["Mermaid", "graph TD\n  A[Kali] --> B[VR]\n  B --> C[Canvas 2D]\n  C --> D[Fidelidad 1:1]"] },
    { wt: "qr", label: "qr", color: "#10b981", make: () => ["QR", JSON.stringify({ url: "https://192.168.1.14:8444/#/vr" })] },
    { wt: "link", label: "link", color: "#60a5fa", make: () => ["Link", JSON.stringify({ url: "https://github.com/fr4j4/kali-companion", title: "Kali Companion — GitHub" })] },
    { wt: "image", label: "image", color: "#8b5cf6", make: () => ["Imagen", JSON.stringify({ url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&q=80", caption: "Imagen de prueba — picsum" })] },
    { wt: "media", label: "media", color: "#8b5cf6", make: () => ["Media", JSON.stringify({ url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&q=80", caption: "Media demo" })] },
    { wt: "entity", label: "entity", color: "#f472b6", make: () => ["Entity", JSON.stringify({ name: "Kali", description: "Asistente IA — companion VR", role: "assistant", status: "online", version: "0.3" })] },
    { wt: "resource", label: "resource", color: "#fb7185", make: () => ["Resource", JSON.stringify({ name: "Guía VR", description: "Recurso de prueba", url: "https://example.com", tags: ["vr","kali"] })] },
    { wt: "place", label: "place", color: "#f97316", make: () => ["Place", JSON.stringify({ name: "Santiago", description: "Capital de Chile", lat: -33.4489, lon: -70.6693 })] },
    { wt: "terminal", label: "terminal", color: "#22c55e", make: () => ["Terminal", "$ ls -la\n total 42\n drwxr-xr-x  kali  4096  .\n -rw-r--r--  app.py  2.1k\n$ echo 'VR listo'\nVR listo"] },
    { wt: "diff", label: "diff", color: "#eab308", make: () => ["Diff", "diff --git a/app.py b/app.py\n@@ -1,3 +1,4 @@\n-const x=1\n+const x=2 // fix VR\n+// fidelidad\n console.log(x)"] },
    { wt: "quiz", label: "quiz", color: "#a78bfa", make: () => ["Quiz VR", JSON.stringify({ questions: [ { q: "¿Capital de Chile?", options: ["Santiago", "Lima", "Bogotá", "Buenos Aires"], answer: 0 }, { q: "¿Cuántos grados de libertad tiene un Quest 3?", options: ["3DoF", "6DoF", "9DoF"], answer: 1 }, { q: "¿Qué empresa fabrica el chip Snapdragon XR2?", options: ["Intel", "AMD", "Qualcomm"], answer: 2 }, { q: "¿Cuál NO es un controlador de WebXR?", options: ["grip", "trigger", "joystick B", "select"], answer: 2 } ] })] },
    { wt: "reasoning", label: "reason", color: "#94a3b8", make: () => ["Reasoning", "## Razonamiento\n\n1. El usuario quiere fidelidad 1:1.\n2. Canvas2D → CanvasTexture es el camino estable.\n3. HTML vivo requiere raster offscreen (next slice)."] },
    { wt: "game", label: "game", color: "#f43f5e", make: () => ["Juegos VR", JSON.stringify({ mode: "launchpad" })] },
    { wt: "controls", label: "controls", color: "#64748b", make: () => ["Controls", JSON.stringify({ controls: [{ type: "slider", label: "Vol", value: 0.7 }] })] },
    { wt: "widget", label: "widget", color: "#64748b", make: () => ["Widget", JSON.stringify({ msg: "widget genérico demo", ts: Date.now() })] },
    { wt: "ui3d", label: "ui3d", color: "#38bdf8", make: () => ["UI3D", JSON.stringify({ root: "root", elements: { root: { type: "group", position: [0,0,0], children: ["box1","sphere1"] }, box1: { type: "box", position: [0,0.6,0], color: "#38bdf8" }, sphere1: { type: "sphere", position: [0.5,0.4,0], color: "#f59e0b" } } })] },
  ];

  const spawnAll = () => { samples.forEach(({ wt, make }) => { const [t,c]=make(); inject(wt,t,c); }); };

  const clearDebug = () => {
    // elimina solo los debug_* del mapa (mantiene los reales de Kali)
    let removed = 0;
    chat.artifacts.forEach((_, id) => { if (id.startsWith("debug_")) { chat.setArtifactContent(id, { ...chat.artifacts.get(id)!, update: "close", content: null } as unknown as import("../lib/protocol").ArtifactEvent); removed++; } });
    // fallback: si el close no los quita del map, nueva sesión limpia todo
    if (removed===0) sound.close(); else sound.select();
  };

  // layout grid 6 cols
  const cols = 6;
  const gapX = 0.19;
  const gapY = 0.072;
  const startX = -((cols - 1) * gapX) / 2;
  const startY = 0.22;

  return (
    <GripGrab>
      <group ref={groupRef}>
        <mesh>
          <planeGeometry args={[1.38, 0.95]} />
          <meshBasicMaterial color="#0b0f14" transparent opacity={0.84} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <group position={[0, 0.42, 0.003]}>
          <Text fontSize={0.026} color="#22c55e" anchorX="center" anchorY="middle">{`DEBUG · ${status} · ${sess} · ${nArtifacts} artifacts`}</Text>
        </group>
        {/* grid launchers */}
        {samples.map(({ wt, label, color, make }, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = startX + col * gapX;
          const y = startY - row * gapY;
          return (
            <Interactive key={wt} onSelect={() => { const [t,c]=make(); inject(wt,t,c); }} onHover={() => sound.hover()}>
              <group position={[x, y, 0.003]}>
                <mesh>
                  <planeGeometry args={[0.174, 0.058]} />
                  <meshBasicMaterial color={color} transparent opacity={0.42} depthWrite={false} />
                </mesh>
                <group position={[0, 0, 0.002]}>
                  <Text fontSize={0.018} color="#e2e8f0" anchorX="center" anchorY="middle">{label}</Text>
                </group>
              </group>
            </Interactive>
          );
        })}
        {/* fila acciones */}
        <Interactive onSelect={spawnAll} onHover={() => sound.hover()}>
          <group position={[-0.34, -0.28, 0.003]}>
            <mesh><planeGeometry args={[0.30, 0.062]} /><meshBasicMaterial color="#38bdf8" transparent opacity={0.52} depthWrite={false} /></mesh>
            <group position={[0,0,0.002]}><Text fontSize={0.019} color="#04070a" anchorX="center" anchorY="middle">★ Spawn todos (23)</Text></group>
          </group>
        </Interactive>
        <Interactive onSelect={clearDebug} onHover={() => sound.hover()}>
          <group position={[0.02, -0.28, 0.003]}>
            <mesh><planeGeometry args={[0.24, 0.062]} /><meshBasicMaterial color="#f59e0b" transparent opacity={0.42} depthWrite={false} /></mesh>
            <group position={[0,0,0.002]}><Text fontSize={0.018} color="#e2e8f0" anchorX="center" anchorY="middle">Limpiar debug</Text></group>
          </group>
        </Interactive>
        <Interactive onSelect={onClose} onHover={() => sound.hover()}>
          <group position={[0.34, -0.28, 0.003]}>
            <mesh><planeGeometry args={[0.18, 0.062]} /><meshBasicMaterial color="#fb7185" transparent opacity={0.42} depthWrite={false} /></mesh>
            <group position={[0,0,0.002]}><Text fontSize={0.018} color="#04070a" anchorX="center" anchorY="middle">✕ Cerrar</Text></group>
          </group>
        </Interactive>
        <Interactive onSelect={() => chat.newSession()} onHover={() => sound.hover()}>
          <group position={[-0.34, -0.36, 0.003]}>
            <mesh><planeGeometry args={[0.30, 0.052]} /><meshBasicMaterial color="#1e293b" transparent opacity={0.55} depthWrite={false} /></mesh>
            <group position={[0,0,0.002]}><Text fontSize={0.016} color="#94a3b8" anchorX="center" anchorY="middle">Nueva sesión</Text></group>
          </group>
        </Interactive>
        <group position={[0.16, -0.36, 0.003]}>
          <Text fontSize={0.014} color="#475569" anchorX="center" anchorY="middle">tap = spawnea + auto-muestra · grip arrastra</Text>
        </group>
      </group>
    </GripGrab>
  );
}

/**
 * GripGrab — igual que RayGrab de xr v5 pero con SQUEEZE (grip) en vez
 * de trigger: el trigger queda libre para seleccionar botones dentro del
 * panel agarrado, y el grip lo toma/suelta. Mantiene el transform relativo
 * entre el panel y el control mientras se aprieta.
 */
function GripGrab({ children }: { children?: React.ReactNode }) {
  const grabbing = useRef<{ controller: THREE.Object3D } | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const prev = useMemo(() => new THREE.Matrix4(), []);
  const gl = useThree((s) => s.gl);

  // A1: snap-to-face opcional — solo si durante el drag la rotación relativa fue grande (>25°);
  // en el caso normal (agarrar y soltar sin girar la muñeca) el panel queda EXACTAMENTE donde está.
  const snapQuat = useRef<THREE.Quaternion | null>(null);
  const startQuat = useRef<THREE.Quaternion | null>(null);

  // Modo de agarre: drag (seguir la mano) o zoom (stick modifica targetDist).
  const mode = useRef<"drag" | "zoom">("drag");
  const targetDist = useRef(0.5);

  useInteraction(groupRef, "onSqueezeStart", (e) => {
    const group = groupRef.current;
    if (!group) return;
    grabbing.current = { controller: e.target.controller };
    snapQuat.current = null; // cancelar snap pendiente — nada se mueve "solo"
    startQuat.current = group.quaternion.clone();
    mode.current = "drag";
    targetDist.current = Math.max(0.4, group.position.distanceTo(e.target.controller.getWorldPosition(new THREE.Vector3())));
    prev.copy(e.target.controller.matrixWorld).invert();
  });

  useInteraction(groupRef, "onSqueezeEnd", () => {
    const group = groupRef.current;
    const s = startQuat.current;
    // snap SOLO si el usuario giró el panel manualmente durante el drag (>25° de delta)
    if (group && s && grabbing.current === null) {
      const dragged = group.quaternion.angleTo(s) > THREE.MathUtils.degToRad(25);
      if (dragged) {
        const cam = gl.xr.getCamera();
        const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld ?? cam.matrix);
        const m = new THREE.Matrix4().lookAt(group.position, camPos, new THREE.Vector3(0, 1, 0));
        snapQuat.current = new THREE.Quaternion().setFromRotationMatrix(m);
      }
    }
    grabbing.current = null;
    startQuat.current = null;
  });

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // snap-to-face solo corre cuando existe un objetivo y no se está agarrando
    if (snapQuat.current && !grabbing.current) {
      group.quaternion.slerp(snapQuat.current, 1 - Math.exp(-12 * Math.min(delta, 0.05)));
      if (group.quaternion.angleTo(snapQuat.current) < 0.01) snapQuat.current = null;
      return; // nada más este frame
    }

    const g = grabbing.current;
    if (!g || !group) return;

    // ── DRAG: el panel sigue la mano (matriz prev→curr) ──
    group.applyMatrix4(prev);
    group.applyMatrix4(g.controller.matrixWorld);

    // ── ZOOM por stick derecho (opcional dentro del drag) ──
    let zoom = 0;
    const session = gl.xr.getSession?.();
    if (session) {
      for (const src of session.inputSources) {
        if (src.handedness !== "right" || !src.gamepad) continue;
        const axes = src.gamepad.axes;
        const raw = axes[3] ?? axes[1] ?? 0;
        const dz = 0.2;
        if (Math.abs(raw) > dz) {
          const norm = (Math.abs(raw) - dz) / (1 - dz);
          zoom = -Math.sign(raw) * norm * norm * 1.2; // máx 1.2 m/s
        }
      }
    }
    if (zoom !== 0) {
      mode.current = "zoom";
      targetDist.current = THREE.MathUtils.clamp(targetDist.current + zoom * delta, 0.4, 2.5);
    } else if (mode.current === "drag") {
      const ctrlPos = g.controller.getWorldPosition(new THREE.Vector3());
      targetDist.current = Math.max(0.4, group.position.distanceTo(ctrlPos));
    }
    if (mode.current === "zoom") {
      const ctrlPos = g.controller.getWorldPosition(new THREE.Vector3());
      const ctrlDir = new THREE.Vector3(0, 0, -1).applyQuaternion(
        g.controller.getWorldQuaternion(new THREE.Quaternion()),
      );
      const pos = ctrlPos.clone().addScaledVector(ctrlDir, targetDist.current);
      const m = new THREE.Matrix4().lookAt(pos, ctrlPos, new THREE.Vector3(0, 1, 0));
      group.quaternion.setFromRotationMatrix(m);
      group.position.copy(pos);
    }

    group.updateMatrixWorld();
    prev.copy(g.controller.matrixWorld).invert();
  });

  return <group ref={groupRef}>{children}</group>;
}

/* ── teclado 3D nativo (visible sin dom-overlay) ──────────────── */

/** Filas QWERTY compactas: [{label, x, w}] con posiciones ya centradas. */
function VRKeyboardRows(): Array<Array<{ label: string; x: number; w: number }>> {
  const row = (keys: string[], w = 0.052): Array<{ label: string; x: number; w: number }> => {
    const total = keys.length * (w + 0.006);
    return keys.map((label, i) => ({ label, x: -total / 2 + i * (w + 0.006) + w / 2, w }));
  };
  return [
    row(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]),
    row(["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]),
    row(["a", "s", "d", "f", "g", "h", "j", "k", "l", "ñ"]),
    row(["z", "x", "c", "v", "b", "n", "m", ".", ",", "?"]),
  ];
}

/** Tecla individual del teclado VR. */
function KeyboardKey({
  x, y = 0, w = 0.052, label, sound, onKey,
}: {
  x: number;
  y?: number;
  w?: number;
  label: string;
  sound: { hover: () => void; select: () => void };
  onKey: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Interactive
      onSelect={() => { sound.select(); onKey(); }}
      onHover={() => { setHovered(true); sound.hover(); }}
      onBlur={() => setHovered(false)}
    >
      <group position={[x, y, 0.002]} scale={hovered ? 1.15 : 1}>
        <mesh>
          <planeGeometry args={[w, 0.03]} />
          <meshBasicMaterial color={hovered ? "#38bdf8" : "#1e293b"} transparent opacity={hovered ? 0.9 : 0.85} depthWrite={false} />
        </mesh>
        <group position={[0, 0, 0.002]}>
          <Text fontSize={0.016} color="#e2e8f0" anchorX="center" anchorY="middle">
            {label}
          </Text>
        </group>
      </group>
    </Interactive>
  );
}

/* ── comandos: voz (PTT) + chat de texto con respuestas ───────── */

/**
 * Palette — paleta de comandos con 3 tabs: Chat / Artefactos / Config.
 * Ventana agarrable (grip) estilo app móvil. El chat replica una app de
 * mensajería: burbujas, input abajo (teclado Quest) y botón de mic con
 * flujo grabar→revisar→enviar/descartar (descartar resetea de verdad).
 */
function CommandsPanel({
  onClose,
  worldIds,
  onOpenArtifact,
}: {
  onClose: () => void;
  worldIds: Set<string>;
  onOpenArtifact: (id: string) => void;
}) {
  const { chat, ptt } = useStage();
  const camera = useThree((s) => s.camera);
  const groupRef = useRef<THREE.Group>(null);
  const [placed, setPlaced] = useState(false);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"chat" | "artifacts" | "config">("chat");
  const [showKeyboard, setShowKeyboard] = useState(false);
  const sound = useUISounds();

  useEffect(() => {
    if (placed || !groupRef.current) return;
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    camDir.y = 0;
    camDir.normalize();
    groupRef.current.position.copy(camPos).addScaledVector(camDir, 1.4);
    groupRef.current.position.y = 1.3;
    groupRef.current.lookAt(camPos);
    setPlaced(true);
  }, [placed, camera]);

  // ── voz: idle → recording → review → (send | discard) ──
  const phase: "idle" | "recording" | "review" =
    ptt.state === "recording" || ptt.state === "listening"
      ? "recording"
      : ptt.finalText
        ? "review"
        : "idle";
  const sendTranscript = useCallback(() => {
    const cleaned = ptt.finalText.replace(/\b(kali|cali)[\s,.;!?]*/gi, "").trim();
    if (cleaned) chat.send(cleaned);
    sound.select();
  }, [ptt.finalText, chat, sound]);
  // Descartar: termina la sesión de grabación y vuelve a idle. El hook
  // limpia finalText al iniciar la próxima grabación (startRecording hace
  // setFinalText("")). El bug anterior era llamar ptt.stop() dos veces.
  const discardTranscript = useCallback(() => {
    if (ptt.state === "recording" || ptt.state === "listening") ptt.stop();
    sound.close();
  }, [ptt, sound]);

  const sttOff = chat.systemStatus?.stt_enabled === false;

  const last = [...chat.messages].slice(-8);
  const artifacts = [...chat.artifacts.values()];

  return (
    <GripGrab>
      <group ref={groupRef}>
        {/* marco de la ventana */}
        <mesh>
          <planeGeometry args={[1.0, 0.72]} />
          <meshBasicMaterial color="#0b0f14" transparent opacity={0.88} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>

        {/* header + cerrar */}
        <group position={[0, 0.315, 0.002]}>
          <Text fontSize={0.028} color="#38bdf8" anchorX="center" anchorY="middle">
            KALI
          </Text>
        </group>
        <Interactive onSelect={() => { sound.close(); onClose(); }} onHover={() => sound.hover()}>
          <group position={[0.435, 0.315, 0.002]}>
            <mesh>
              <planeGeometry args={[0.09, 0.05]} />
              <meshBasicMaterial color="#fb7185" transparent opacity={0.45} depthWrite={false} />
            </mesh>
            <group position={[0, 0, 0.002]}>
              <Text fontSize={0.024} color="#e2e8f0" anchorX="center" anchorY="middle">✕</Text>
            </group>
          </group>
        </Interactive>

        {/* tabs */}
        {([
          { x: -0.3, label: "Chat", t: "chat" as const, color: "#38bdf8" },
          { x: -0.06, label: "Artefactos", t: "artifacts" as const, color: "#a78bfa" },
          { x: 0.2, label: "Config", t: "config" as const, color: "#fbbf24" },
        ]).map(({ x, label, t, color }) => (
          <Interactive key={t} onSelect={() => { sound.select(); setTab(t); }} onHover={() => sound.hover()}>
            <group position={[x, 0.24, 0.002]}>
              <mesh>
                <planeGeometry args={[0.21, 0.05]} />
                <meshBasicMaterial color={color} transparent opacity={tab === t ? 0.75 : 0.18} depthWrite={false} />
              </mesh>
              <group position={[0, 0, 0.002]}>
                <Text fontSize={0.022} color={tab === t ? "#ffffff" : "#94a3b8"} anchorX="center" anchorY="middle">{label}</Text>
              </group>
            </group>
          </Interactive>
        ))}

        {/* ═══ TAB CHAT — layout con bandas duras (sin superposición) ═══
            ventana 1.0×0.72 centrada en 0,0 → Y de -0.36 a +0.36
            tabs (fijas): +0.24 ± 0.025 → contenido desde +0.19 hacia abajo
            banda burbujas: +0.19 a -0.13 (6 burbujas de 0.052)
            banda mic/estado: -0.145 a -0.195
            banda input+enviar: -0.22 a -0.27
            teclado 3D: -0.30 hacia abajo                                          */}
        {tab === "chat" && (
          <group position={[0, -0.02, 0.002]}>
            {/* burbujas — máx 6, banda +0.19..-0.13 */}
            {last.slice(0, 6).map((m, i) => {
              const mine = m.role === "user";
              return (
                <group key={m.id} position={[mine ? 0.24 : -0.26, 0.165 - i * 0.062, 0.002]}>
                  <mesh>
                    <planeGeometry args={[0.42, 0.05]} />
                    <meshBasicMaterial
                      color={mine ? "#0369a1" : "#1e293b"}
                      transparent opacity={0.85} depthWrite={false}
                    />
                  </mesh>
                  <group position={[0, 0, 0.002]}>
                    <Text fontSize={0.014} color="#e2e8f0" anchorX="center" anchorY="middle" maxWidth={0.4}>
                      {`${mine ? "tú" : "Kali"}: ${m.content.slice(0, 70)}`}
                    </Text>
                  </group>
                </group>
              );
            })}

            {/* overlay de revisión de voz (reemplaza burbujas bajas) */}
            {phase === "review" && (
              <group position={[0, -0.075, 0.004]}>
                <mesh>
                  <planeGeometry args={[0.94, 0.115]} />
                  <meshBasicMaterial color="#020617" transparent opacity={0.9} depthWrite={false} />
                </mesh>
                <group position={[0, 0.032, 0.002]}>
                  <Text fontSize={0.018} color="#e2e8f0" anchorX="center" anchorY="middle" maxWidth={0.88}>
                    {`"${ptt.finalText.slice(0, 90)}"`}
                  </Text>
                </group>
                <MenuItem y={-0.032} x={-0.2} w={0.17} color="#38bdf8" text="▶ Enviar" sound={sound} onSelect={sendTranscript} />
                <MenuItem y={-0.032} x={0.2} w={0.17} color="#fb7185" text="✕ Descartar" sound={sound}
                  onSelect={discardTranscript} />
              </group>
            )}

            {/* banda mic + estado: -0.145..-0.195 */}
            <Interactive
              onSelect={() => {
                if (phase === "recording") { ptt.stop(); sound.close(); }
                else if (phase === "idle") { void ptt.start(); sound.rec(); }
              }}
              onHover={() => sound.hover()}
            >
              <group position={[-0.36, -0.17, 0.004]}>
                <mesh>
                  <planeGeometry args={[0.14, 0.045]} />
                  <meshBasicMaterial
                    color={phase === "recording" ? "#fbbf24" : "#22c55e"}
                    transparent opacity={0.75} depthWrite={false}
                  />
                </mesh>
                <group position={[0, 0, 0.002]}>
                  <Text fontSize={0.02} color="#04070a" anchorX="center" anchorY="middle">
                    {phase === "recording" ? "■ stop" : "🎤 mic"}
                  </Text>
                </group>
              </group>
            </Interactive>
            <group position={[0.02, -0.17, 0.004]}>
              <Text fontSize={0.017} color={phase === "recording" ? "#34d399" : sttOff ? "#fb7185" : "#64748b"} anchorX="left" anchorY="middle" maxWidth={0.5}>
                {phase === "recording"
                  ? `● ${ptt.partialText || "habla…"}`
                  : sttOff
                    ? "⚠ STT deshabilitado (Settings 2D)"
                    : ptt.error
                      ? `⚠ ${ptt.error.slice(0, 45)}`
                      : "pulsa 🎤 y habla"}
              </Text>
            </group>

            {/* banda input + enviar: -0.22..-0.27 (nativo 3D) */}
            <Interactive
              onSelect={() => {
                if (draft.trim()) {
                  sound.select();
                  chat.send(draft);
                  setDraft("");
                } else {
                  sound.open(); // sin texto: abre la pista del teclado
                }
              }}
              onHover={() => sound.hover()}
            >
              <group position={[-0.06, -0.245, 0.004]}>
                <mesh>
                  <planeGeometry args={[0.6, 0.05]} />
                  <meshBasicMaterial color="#020617" transparent opacity={0.85} depthWrite={false} />
                </mesh>
                <group position={[-0.28, 0, 0.002]}>
                  <Text fontSize={0.018} color={draft ? "#e2e8f0" : "#475569"} anchorX="left" anchorY="middle" maxWidth={0.54}>
                    {draft ? draft.slice(-38) : "toca aquí y usa el teclado →"}
                  </Text>
                </group>
              </group>
            </Interactive>
            <Interactive onSelect={() => {
              if (!draft.trim()) return;
              sound.select();
              chat.send(draft);
              setDraft("");
            }} onHover={() => sound.hover()}>
              <group position={[0.33, -0.245, 0.004]}>
                <mesh>
                  <planeGeometry args={[0.12, 0.05]} />
                  <meshBasicMaterial color="#38bdf8" transparent opacity={draft ? 0.9 : 0.3} depthWrite={false} />
                </mesh>
                <group position={[0, 0, 0.002]}>
                  <Text fontSize={0.02} color="#04070a" anchorX="center" anchorY="middle">➤</Text>
                </group>
              </group>
            </Interactive>

            {/* teclado 3D — pista QWERTY compacta (nativo, siempre visible) */}
            {showKeyboard && (
              <group position={[0, -0.52, 0.01]} scale={0.92}>
                {VRKeyboardRows().map((row, r) => (
                  <group key={r} position={[0, -r * 0.038, 0]}>
                    {row.map((k) => (
                      <KeyboardKey
                        key={k.label}
                        x={k.x}
                        w={k.w}
                        label={k.label}
                        sound={sound}
                        onKey={() => setDraft((d) => d + k.label)}
                      />
                    ))}
                  </group>
                ))}
                <KeyboardKey x={-0.28} y={-0.19} w={0.1} label="ESPACIO" sound={sound} onKey={() => setDraft((d) => d + " ")} />
                <KeyboardKey x={0.02} y={-0.19} w={0.09} label="←" sound={sound} onKey={() => setDraft((d) => d.slice(0, -1))} />
                <KeyboardKey x={0.15} y={-0.19} w={0.1} label="ENviar" sound={sound}
                  onKey={() => { if (draft.trim()) { chat.send(draft); setDraft(""); } }} />
                <KeyboardKey x={0.3} y={-0.19} w={0.07} label="✕" sound={sound} onKey={() => setShowKeyboard(false)} />
              </group>
            )}
            {!showKeyboard && (
              <Interactive onSelect={() => { sound.open(); setShowKeyboard(true); }} onHover={() => sound.hover()}>
                <group position={[0.33, -0.29, 0.004]}>
                  <mesh>
                    <planeGeometry args={[0.12, 0.032]} />
                    <meshBasicMaterial color="#a78bfa" transparent opacity={0.5} depthWrite={false} />
                  </mesh>
                  <group position={[0, 0, 0.002]}>
                    <Text fontSize={0.016} color="#e2e8f0" anchorX="center" anchorY="middle">ABC…</Text>
                  </group>
                </group>
              </Interactive>
            )}
          </group>
        )}

        {/* ═══ TAB ARTEFACTOS ═══ */}
        {tab === "artifacts" && (
          <group position={[0, -0.03, 0.002]}>
            {artifacts.length === 0 && (
              <Text fontSize={0.022} color="#64748b" anchorX="center" anchorY="middle">
                Sin artefactos aún — pídele algo a Kali
              </Text>
            )}
            {artifacts.slice(0, 7).map((ev, i) => {
              const inWorld = worldIds.has(ev.id) || ev.windowType === "ui3d";
              return (
                <group key={ev.id} position={[0, 0.24 - i * 0.075, 0.002]}>
                  <Interactive onSelect={() => onOpenArtifact(ev.id)} onHover={() => sound.hover()}>
                    <mesh>
                      <planeGeometry args={[0.86, 0.062]} />
                      <meshBasicMaterial color="#1e293b" transparent opacity={inWorld ? 0.35 : 0.8} depthWrite={false} />
                    </mesh>
                    <group position={[-0.36, 0, 0.003]}>
                      <Text fontSize={0.02} color={inWorld ? "#64748b" : "#a78bfa"} anchorX="left" anchorY="middle">
                        {inWorld ? "◉ en el mundo" : "◎ mostrar"}
                      </Text>
                    </group>
                    <group position={[0.015, 0, 0.003]}>
                      <Text fontSize={0.02} color="#e2e8f0" anchorX="left" anchorY="middle" maxWidth={0.55}>
                        {`${ev.title || ev.windowType} · ${ev.windowType}`}
                      </Text>
                    </group>
                  </Interactive>
                </group>
              );
            })}
            <group position={[0, -0.32, 0.002]}>
              <Text fontSize={0.016} color="#64748b" anchorX="center" anchorY="middle">
                los nuevos de Kali aparecen solos frente a ti
              </Text>
            </group>
          </group>
        )}

        {/* ═══ TAB CONFIG ═══ */}
        {tab === "config" && (
          <group position={[0, -0.03, 0.002]}>
            {(() => {
              const s = chat.systemStatus;
              const rows: Array<[string, string]> = [
                ["LLM", `${s?.llm_active ? "●" : "○"} ${s?.llm_model || s?.llm_provider || "—"}`],
                ["Conexión", s?.llm_connection_name || "activa"],
                ["API key", s?.llm_api_key_set ? "✓ configurada" : "✗ no"],
                ["TTS", `${s?.tts_provider || "—"} · ${s?.voice || "—"}`],
                ["STT", `${s?.stt_provider || "—"} · ${s?.stt_enabled ? "on" : "off"}`],
                ["VAD", s?.stt_vad_enabled ? `on (${s?.stt_vad_silence_timeout ?? 1}s)` : "off"],
                ["Idioma", s?.stt_language || "—"],
                ["Perfil", s?.profile || "—"],
              ];
              return rows.map(([k, v], i) => (
                <group key={k} position={[0, 0.26 - i * 0.075, 0.002]}>
                  <Text fontSize={0.02} color="#94a3b8" anchorX="left" anchorY="middle">
                    {k}
                  </Text>
                  <Text fontSize={0.02} color="#e2e8f0" anchorX="right" anchorY="middle" position={[0.43, 0, 0.001]}>
                    {v.slice(0, 28)}
                  </Text>
                </group>
              ));
            })()}
            <group position={[0, -0.33, 0.002]}>
              <Text fontSize={0.016} color="#64748b" anchorX="center" anchorY="middle">
                solo lectura — edición en Settings del canvas 2D
              </Text>
            </group>
          </group>
        )}
      </group>
    </GripGrab>
  );
}

/** Renderiza el contenido según el tipo REAL del artefacto. */
function ArtifactBody({ ev }: { ev: ArtifactEvent }) {
  const content = ev.content ?? "";
  if (ev.windowType === "table" || ev.windowType === "checklist") {
    try {
      const data = JSON.parse(content) as {
        rows?: Array<Record<string, unknown>>;
        items?: Array<{ text: string; done?: boolean }>;
      };
      if (data.rows?.length) {
        const cols = Object.keys(data.rows[0]);
        return (
          <>
            {data.rows.slice(0, 12).map((r, i) => (
              <group key={i} position={[0, -i * 0.042, 0.003]}>
                <Text fontSize={0.016} color={i === 0 ? "#7dd3fc" : "#e2e8f0"} anchorX="left" anchorY="middle" maxWidth={0.8}>
                  {cols.map((c) => String(r[c] ?? "").slice(0, 14)).join("  |  ")}
                </Text>
              </group>
            ))}
          </>
        );
      }
      if (data.items?.length) {
        return (
          <>
            {data.items.slice(0, 12).map((it, i) => (
              <group key={i} position={[0, -i * 0.042, 0.003]}>
                <Text fontSize={0.017} color={it.done ? "#34d399" : "#e2e8f0"} anchorX="left" anchorY="middle" maxWidth={0.8}>
                  {`${it.done ? "☑" : "☐"} ${it.text}`}
                </Text>
              </group>
            ))}
          </>
        );
      }
    } catch { /* cae a texto plano */ }
  }
  if (ev.windowType === "code" || ev.windowType === "json") {
    return (
      <>
        {content.split("\n").slice(0, 14).map((l, i) => (
          <group key={i} position={[0, -i * 0.04, 0.003]}>
            <Text fontSize={0.015} color="#a5b4fc" anchorX="left" anchorY="middle" maxWidth={0.84}>
              {l.slice(0, 70) || " "}
            </Text>
          </group>
        ))}
      </>
    );
  }
  // document/markdown/html → texto plano paginable (markdown ya legible)
  const lines = content.replace(/<[^>]+>/g, " ").split("\n").filter((l) => l.trim());
  return (
    <>
      {lines.slice(0, 14).map((l, i) => (
        <group key={i} position={[0, -i * 0.042, 0.003]}>
          <Text
            fontSize={l.startsWith("#") ? 0.022 : 0.016}
            color={l.startsWith("#") ? "#38bdf8" : "#e2e8f0"}
            anchorX="left" anchorY="middle" maxWidth={0.84}
          >
            {l.replace(/^#+\s*/, "").slice(0, 70) || " "}
          </Text>
        </group>
      ))}
    </>
  );
}

/**
 * Widget2DPanel — en lobby 2D monta el widget real con <Html transform>
 * (fidelidad total). En XR inmersivo el DOM es INVISIBLE (CSS3D no se
 * renderiza dentro del HMD) → usa render nativo 3D (ArtifactBody con
 * <Text>) agarrable. El bug del "todo negro" era <Html> invisible +
 * Suspensión sin boundary.
 */




/** A5: streaming fuera de foco -> throttled a 1 update / 2s. */
function useThrottledEv(ev: ArtifactEvent, focused: boolean): ArtifactEvent {
  const [, bump] = useState(0);
  const snapshot = useRef(ev);
  const lastLive = useRef(0);
  const frozen = ev.phase === "streaming" && !focused && Date.now() - lastLive.current < 2000;
  useEffect(() => {
    if (!frozen) {
      snapshot.current = ev;
      lastLive.current = Date.now();
      bump((v) => v + 1);
    }
  }, [ev, frozen]);
  return frozen ? snapshot.current : ev;
}

/** A3: resumen de 1 línea por tipo para la mini-card. */
function VrWidgetSummary(ev: { windowType: string; content: string | null }): string {
  const c = ev.content ?? "";
  try {
    const d = JSON.parse(c);
    if (Array.isArray(d?.rows)) return `${d.rows.length} filas`;
    if (Array.isArray(d?.items)) return `${d.items.length} items`;
    if (Array.isArray(d?.questions)) return `${d.questions.length} preguntas`;
  } catch { /* texto plano */ }
  const lines = c.split("\n").filter(Boolean).length;
  if (lines > 1) return `${lines} líneas`;
  return c.slice(0, 30) || "vacío";
}

function Widget2DPanel({ ev, index, onClose, onMinimize }: { ev: ArtifactEvent; index: number; onClose: () => void; onMinimize: () => void }) {
  const chat = useStage().chat;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const xrPresenting = useXR((s: unknown) => (s as { isPresenting?: boolean; session?: unknown }).isPresenting ?? (s as { session?: unknown }).session != null);
  const isImmersive = xrPresenting || (gl.xr as { isPresenting?: boolean }).isPresenting;
  const groupRef = useRef<THREE.Group>(null);
  const [placed, setPlaced] = useState(false);
  const vrFont = useVrFont();
  const [focused, setFocused] = useState(false);
  useEffect(() => subscribeFocusedPanel((f) => setFocused(f?.id === ev.id)), [ev.id]);
  // A5: streaming + panel sin foco => congelar ev a 1 actualización/2s (ahorra GPU en Quest)
  const evThrottled = useThrottledEv(ev, focused);
  // A4: barra de progreso de scroll
  const scrollRef = useRef<{ scrollPosition?: { value: [number, number] }; maxScrollPosition?: { value: [number, number] } } | null>(null);
  const [scrollPct, setScrollPct] = useState(1);
  useEffect(() => {
    const iv = setInterval(() => {
      const sc = scrollRef.current as { scrollPosition?: { value: [number, number] }; maxScrollPosition?: { value: [number, number] } } | null;
      if (!sc?.scrollPosition || !sc.maxScrollPosition) return;
      const [maxY] = sc.maxScrollPosition.value;
      const [y] = sc.scrollPosition.value;
      const pct = maxY > 0 ? Math.max(0.06, Math.min(1, 1 - Math.abs(y / maxY))) : 1;
      setScrollPct(pct);
    }, 250);
    return () => clearInterval(iv);
  }, []);
  // A2: drag por rayo desde el header (trigger mantenido)
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current && rayDrag.panelId !== ev.id) draggingRef.current = false;
  }, [ev.id]);
  const focusPanel = useCallback(() => {
    if (!groupRef.current) return;
    setFocusedPanel({ id: ev.id, title: ev.title || ev.windowType, rootObj: groupRef.current });
  }, [ev.id, ev.title, ev.windowType]);

  // Colocación: al montar y al entrar en XR (la pose cambia entre modos).
  useEffect(() => {
    const place = () => {
      if (!groupRef.current) return;
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();
      // Distribuir en abanico frontal 180° sin pisarse: para n<=6, ángulos equidistantes; para spawn todos (6) quedan 30° separados
      // Usamos total estimado 6 (max visibles) si index<6, si no wrap. Altura escalonada para segunda fila.
      const totalHint = 6;
      const span = 1.6; // ~92° a cada lado
      const angle = totalHint > 1 ? -span/2 + (span * (index % totalHint)) / (totalHint - 1) : 0;
      const radius = 2.0 + (Math.floor(index / 3) * 0.45); // segunda fila 0.45m más atrás
      const dirRot = camDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      groupRef.current.position.copy(camPos).addScaledVector(dirRot, radius);
      groupRef.current.position.y = 1.55 + (index % 2) * 0.18;
      groupRef.current.lookAt(camPos);
      setPlaced(true);
    };
    place();
  }, [placed, camera, index]);

  // A2: movimiento por rayo mientras el drag está activo con ESTE panel
  useFrame((_, delta) => {
    if (rayDrag.active && rayDrag.panelId === ev.id && groupRef.current) {
      // detectar release del trigger derecho (button 0)
      const session = gl.xr.getSession?.();
      let triggerDown = false;
      if (session) {
        for (const src of session.inputSources) {
          if (src.handedness === "right" && src.gamepad) {
            triggerDown = src.gamepad.buttons[0]?.pressed ?? false;
            break;
          }
        }
      }
      if (!triggerDown) {
        rayDrag.active = false;
        rayDrag.panelId = null;
        draggingRef.current = false;
        return;
      }
      // mover panel por el rayo del control derecho a rayDrag.distance (suavizado)
      for (const src of session?.inputSources ?? []) {
        if (src.handedness !== "right") continue;
        const c = (src as unknown as { targetRaySpace?: THREE.Object3D }).targetRaySpace;
        if (!c) continue;
        const cam = new THREE.Object3D();
        cam.matrixWorld.copy(c.matrixWorld);
        const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion()));
        const targetDist = THREE.MathUtils.clamp(rayDrag.distance, 0.5, 2.5);
        const targetPos = origin.clone().addScaledVector(dir, targetDist);
        groupRef.current.position.lerp(targetPos, 1 - Math.exp(-14 * Math.min(delta, 0.05)));
        const camPos = new THREE.Vector3().setFromMatrixPosition((gl.xr.getCamera() as unknown as THREE.Camera).matrixWorld ?? new THREE.Matrix4());
        const m = new THREE.Matrix4().lookAt(groupRef.current.position, camPos, new THREE.Vector3(0, 1, 0));
        groupRef.current.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), 1 - Math.exp(-14 * Math.min(delta, 0.05)));
        break;
      }
    }
  }, -1);

  const wt = ev.windowType as WindowType;
  const entry = widgetRegistry[wt];
  const Widget = entry?.component;

  if (isImmersive) {
    // Fallback nativo garantizado: si uikit no pinta, el título sigue visible.
    // El VrWidgetRenderer queda encima con clip; el Text de respaldo queda detrás.
    return (
      <GripGrab>
        <group ref={groupRef}>
          {/* backing sutil — solo borde, no tapa el VrWidgetRenderer */}
          <mesh position={[0, 0, -0.012]}>
            <planeGeometry args={[0.94, 0.76]} />
            <meshBasicMaterial color={focused ? "#0ea5e9" : "#0b0f14"} transparent opacity={focused ? 0.35 : 0.98} side={THREE.DoubleSide} />
          </mesh>
          {/* A4: barra de progreso de scroll (borde derecho) */}
          {scrollPct < 0.99 && (
            <mesh position={[0.455, 0.36 - (0.72 * (1 - scrollPct)) / 2 - 0.36 * scrollPct, 0.014]}>
              <planeGeometry args={[0.006, 0.7 * scrollPct]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.9} />
            </mesh>
          )}

          <Root pixelSize={0.002} sizeX={0.84} sizeY={0.74} flexDirection="column" gap={6} padding={6} fontFamilies={vrFont ?? undefined} onPointerDown={focusPanel}>
            <Container
              width="100%"
              height={32}
              backgroundColor="#111827"
              borderRadius={8}
              padding={6}
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              onPointerDown={() => {
                // A2: mantener trigger sobre el header = arrastrar por rayo
                draggingRef.current = true;
                rayDrag.active = true;
                rayDrag.panelId = ev.id;
                const cam = gl.xr.getCamera();
                const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld ?? cam.matrix);
                rayDrag.distance = THREE.MathUtils.clamp(groupRef.current!.position.distanceTo(camPos), 0.5, 2.5);
              }}
            >
              <Container flexDirection="row" alignItems="center" gap={6}>
                {/* dot de color por tipo — distinguible de lejos */}
                <Container width={10} height={10} borderRadius={5} backgroundColor={TYPE_COLORS[wt] ?? "#64748b"} />
                <UIKitText fontSize={11} color="#e2e8f0">{ev.title || ev.windowType}</UIKitText>
                {ev.phase === "streaming" && (
                  <Container backgroundColor="#1e3a5f" borderRadius={4} padding={4}>
                    <UIKitText fontSize={9} color="#38bdf8">● escribiendo…</UIKitText>
                  </Container>
                )}
              </Container>
              <Container flexDirection="row" gap={4}>
                <Container width={26} height={22} backgroundColor="#1e293b" borderRadius={6} justifyContent="center" alignItems="center" hover={{ backgroundColor: "#38bdf8" }} onClick={onMinimize}>
                  <UIKitText fontSize={12} color="#38bdf8">–</UIKitText>
                </Container>
                <Container width={30} height={22} backgroundColor="#fb7185" borderRadius={6} justifyContent="center" alignItems="center" hover={{ backgroundColor: "#ff6b7a" }} onClick={() => { setFocusedPanel(null); onClose(); }}>
                  <UIKitText fontSize={12} color="#04070a">✕</UIKitText>
                </Container>
              </Container>
            </Container>
            <Container
              ref={scrollRef as never}
              width="100%"
              flexGrow={1}
              backgroundColor="#0b0f14"
              borderRadius={8}
              padding={8}
              overflow="scroll"
              scrollbarWidth={4}
              flexDirection="column"
            >
              {(ev.content ?? "") === "" ? (
                <Container flexDirection="column" gap={8} justifyContent="center" alignItems="center" height="100%">
                  <UIKitText fontSize={13} color="#38bdf8">✍ escribiendo…</UIKitText>
                  <Container width={200} height={10} backgroundColor="#1e293b" borderRadius={5} />
                  <Container width={160} height={10} backgroundColor="#1e293b" borderRadius={5} />
                  <Container width={180} height={10} backgroundColor="#1e293b" borderRadius={5} />
                </Container>
              ) : (
                <VrWidgetRenderer
                  ev={evThrottled}
                  onSetContent={(next) => chat.setArtifactContent(ev.id, next)}
                />
              )}
            </Container>
          </Root>
        </group>
      </GripGrab>
    );
  }

  return (
    <GripGrab>
      <group ref={groupRef}>
        {/* marco 3D de fondo (da cuerpo al panel y contraste al DOM) */}
        <mesh>
          <planeGeometry args={[0.86, 0.62]} />
          <meshBasicMaterial color="#0b0f14" transparent opacity={0.96} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <Html
          transform
          distanceFactor={0.5}
          occlude={false}
          position={[0, 0, 0.01]}
          style={{ width: 470 }}
        >
          <div
            style={{
              background: "#0b0f14",
              border: "1px solid #1e293b",
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
            }}
          >
            {/* header DOM: título + cerrar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderBottom: "1px solid #1e293b",
              background: "#111827",
            }}>
              <span style={{ color: "#38bdf8", fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {(ev.title || ev.windowType) + " · " + ev.windowType}
              </span>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: 26, height: 26, borderRadius: 6, border: "none",
                  background: "#fb7185", color: "#04070a",
                  fontWeight: 700, cursor: "pointer", flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
            {/* cuerpo: el widget real del canvas 2D — Suspense OBLIGATORIO:
                los widgets son React.lazy y sin boundary la suspensión
                deja el panel en negro */}
            <div style={{ width: "100%", maxHeight: 380, overflow: "auto", background: "#e2e8f0", color: "#04070a" }}>
              <ErrorBoundary fallback={<pre style={{ padding: 12, whiteSpace: "pre-wrap", fontSize: 12 }}>{ev.content?.slice(0, 2000) ?? "(vacío)"}</pre>}>
                <Suspense fallback={
                  <div style={{ padding: 20, textAlign: "center", color: "#334155", fontSize: 13 }}>
                    cargando widget…
                  </div>
                }>
                  {Widget ? <Widget content={ev} /> : <ArtifactBody ev={ev} />}
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </Html>
      </group>
    </GripGrab>
  );
}

/** Puente: los artefactos marcados como "en el mundo" se renderizan. */
function Widget2DPanels({
  sessionId, live, worldIds, minimized, onMinimize, onRestore, onClose,
}: {
  sessionId: string | null;
  live: ArtifactEvent[];
  worldIds: Set<string>;
  minimized: Set<string>;
  onMinimize: (id: string) => void;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const inWorld = live.filter((ev) => worldIds.has(ev.id));
  const twoD = inWorld.filter((ev) => ev.windowType !== "ui3d").slice(0, 6);
  const minList = twoD.filter((ev) => minimized.has(ev.id));
  // worldIds es un Set ordenado por inserción: el slot queda estable aunque
  // lleguen artefactos nuevos o se actualicen (no re-coloca a los existentes).
  const slotOf = (id: string) => [...worldIds].filter((wid) => twoD.some((e) => e.id === wid)).indexOf(id);
  return (
    <>
      {twoD.filter((ev) => !minimized.has(ev.id)).map((ev) => (
        <Widget2DPanel key={ev.id} ev={ev} index={slotOf(ev.id)} onClose={() => onClose(ev.id)} onMinimize={() => onMinimize(ev.id)} />
      ))}
      {minList.map((ev) => (
        <VrMiniCard
          key={`mini-${ev.id}`}
          title={ev.title || ev.windowType}
          windowType={ev.windowType}
          summary={VrWidgetSummary(ev)}
          slot={minList.indexOf(ev)}
          onRestore={() => onRestore(ev.id)}
        />
      ))}
      {/* los ui3d siguen por su camino propio (ScenePanel) */}
      {inWorld.filter((ev) => ev.windowType === "ui3d").slice(0, 9).map((ev, i) => (
        <ScenePanel key={ev.id} ev={ev} index={i} sessionId={sessionId} />
      ))}
    </>
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
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [worldIds, setWorldIds] = useState<Set<string>>(new Set());
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(new Set());
  const exitVR = useExitVR();
  const toggleMenu = useCallback(() => setMenuOpen((o) => !o), []);
  const toggleCommands = useCallback(() => setCommandsOpen((o) => !o), []);
  const openArtifact = useCallback((id: string) => {
    setWorldIds((prev) => new Set(prev).add(id));
  }, []);
  // Auto-spawn: cuando el asistente empieza a escribir un artefacto streamable
  // (code/document/diff/html/mermaid) aparece solo en el mundo; los no-streamables
  // (table/quiz/chart/...) aparecen al completarse. Los cerrados por el usuario
  // (userClosedRef) no se re-abren.
  const userClosedRef = useRef<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const ev of live) {
      if (knownIdsRef.current.has(ev.id)) continue;
      knownIdsRef.current.add(ev.id);
      if (userClosedRef.current.has(ev.id)) continue;
      const streamable = ["code", "document", "diff", "html", "mermaid"].includes(ev.windowType);
      const ready = streamable ? ev.content !== "" : ev.phase === "complete";
      if (ready) {
        setWorldIds((prev) => (prev.size < 6 ? new Set(prev).add(ev.id) : prev));
      } else {
        // aún vacío — reintentar cuando llegue contenido: quitar del known
        knownIdsRef.current.delete(ev.id);
      }
    }
  }, [live]);
  const closeArtifact = useCallback((id: string) => {
    userClosedRef.current.add(id);
    setWorldIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

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

      <Canvas camera={{ position: [0, 1.6, 2], fov: 60 }} dpr={[1, 2]} gl={{ antialias: true, localClippingEnabled: true }}>
        <color attach="background" args={["#04070a"]} />
        <fog attach="fog" args={["#04070a", 10, 40]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[4, 8, 4]} intensity={0.9} />
        <pointLight position={[0, 2.5, -2]} intensity={12} distance={9} color="#22c55e" />

        <XR>
          {/* Controllers/Hands/menú viven DENTRO del rig: heredan el
              transform del jugador y viajan con él al caminar/girar. */}
          <PlayerRig onToggleMenu={toggleMenu} onToggleX={toggleCommands}>
            <Controllers />
            <Hands />
            <WristMenu
              open={menuOpen}
              onExit={exitVR}
              onClose={() => setMenuOpen(false)}
              onOpenDebug={() => setDebugOpen(true)}
              onOpenCommands={() => setCommandsOpen(true)}
            />
          </PlayerRig>
          {debugOpen && <DebugPanel onClose={() => setDebugOpen(false)} onOpenArtifact={openArtifact} />}
          {commandsOpen && (
            <CommandsPanel
              onClose={() => setCommandsOpen(false)}
              worldIds={worldIds}
              onOpenArtifact={openArtifact}
            />
          )}
          <MatrixFloor />
          <VRDebugCompass />
          <InteractivePrimitives />
          {/* pelotitas removidas — solo artefactos reales */}
          <XrPointerBridge />
          <ArtifactPanels sessionId={sessionId} live={live} />
          <Widget2DPanels
            sessionId={sessionId}
            live={live}
            worldIds={worldIds}
            minimized={minimizedIds}
            onMinimize={(id) => setMinimizedIds((prev) => new Set(prev).add(id))}
            onRestore={(id) => setMinimizedIds((prev) => { const n = new Set(prev); n.delete(id); return n; })}
            onClose={closeArtifact}
          />
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

/** Artefactos vivos con contenido renderizable (cualquier windowType). */
function isLiveComplete(ev: ArtifactEvent): boolean {
  return ev.update !== "close" && ev.content != null;
}

/** Compact in-XR mirror of the live ui3d artifact count. */
// @ts-ignore unused pelotitas removidas
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
  // Cualquier artefacto vivo sin contenido (2D o ui3d) se completa por
  // REST — no solo ui3d (los 2D preexistentes no aparecían: el filtro
  // anterior los excluía del fetch).
  useEffect(() => {
    const sid = chat.sessionId;
    if (!sid) {
      setFetched([]);
      return;
    }
    let alive = true;
    const missing = [...chat.artifacts.values()].filter(
      (ev) => ev.update !== "close" && ev.content == null,
    );
    if (missing.length === 0) return;
    Promise.all(
      missing.map((ev) =>
        fetchArtifact(sid, ev.id)
          .then((res) => ({ ...ev, content: res.content }) as ArtifactEvent)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!alive) return;
      const ok = results.filter((x): x is ArtifactEvent => x != null);
      setFetched((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        for (const p of ok) byId.set(p.id, p);
        return [...byId.values()];
      });
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