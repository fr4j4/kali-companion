/**
 * VREntry — default immersive environment ("Enter VR" lobby).
 *
 * Routes: /vr (lobby) and /vr/session/:sid (attach to a Kali session).
 * A fixed default scene — floor, walls, center pedestal, soft sky orb —
 * that anyone can enter from the Quest browser: open /#/vr, press the
 * button, grant the permission, and you're inside the room. Live ui3d
 * artifacts from the attached session are fetched (REST) and float as
 * panels in the room. The lobby reuses StageProvider, so the WS
 * connection, session attach and the artifact map are the same objects
 * the main UI uses — no parallel state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { XR, Controllers, Hands, Interactive, useXR } from "@react-three/xr";
import { StageProvider, useStage } from "../stage/StageProvider";
import { AuthGate } from "../components/AuthGate";
import { fetchArtifact } from "../lib/artifacts";
import type { ArtifactEvent } from "../lib/protocol";
import { Ui3dSceneNodes, type Ui3dScene } from "../components/widgets/Ui3dWidget";
import { parseContent } from "../components/widgets/base/DataWidget";

/* ── WebXR plumbing (shared logic with Ui3dWidget) ────────────── */

type VRSupport = "checking" | "supported" | "unsupported";

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

/* ── default room (escena predeterminada) ─────────────────────── */

const DEFAULT_ROOM: Ui3dScene = {
  root: "sala",
  elements: {
    sala: {
      type: "group",
      children: ["suelo", "pedestal", "estrella"],
    },
    suelo: { type: "box", position: [0, -0.05, 0], scale: [8, 0.1, 8], color: "#1e293b" },
    pedestal: { type: "box", position: [0, 0.5, 0], scale: [0.9, 1, 0.9], color: "#334155" },
    estrella: { type: "sphere", position: [0, 3.2, 0], scale: 0.5, color: "#fbbf24" },
  },
};

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
  const [error, setError] = useState(false);

  useEffect(() => {
    const parsed = sceneFromEvent(ev);
    if (parsed) {
      setScene(parsed);
      return;
    }
    // Metadata-only replay: fetch full content via REST.
    if (!sessionId || !ev.id) {
      setError(true);
      return;
    }
    let alive = true;
    fetchArtifact(sessionId, ev.id)
      .then((res) => {
        if (!alive) return;
        const asEvent = { ...ev, content: res.content } as ArtifactEvent;
        setScene(sceneFromEvent(asEvent));
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [ev, sessionId]);

  const parsed = scene ?? (error ? DEFAULT_ROOM : null);
  if (!parsed) return null;

  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = (col - 1) * 2.6;
  const y = 1.9 - row * 1.5;
  const z = -3;

  return (
    <group position={[x, y, z]} scale={0.28}>
      <Ui3dSceneNodes scene={parsed} />
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

/* ── room canvas ──────────────────────────────────────────────── */

/** Thumbstick locomotion: mueve el jugador con el stick izq (X/Y del gamepad). */
function ThumbstickLocomotion() {
  const camera = useThree((s) => s.camera);
  const dir = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const session = glXRSessionRef.current as XRSession | null;
    if (!session) return;
    for (const source of session.inputSources) {
      if (source.handedness !== "left" || !source.gamepad) continue;
      const [x, y] = [source.gamepad.axes[2] ?? 0, source.gamepad.axes[3] ?? 0];
      if (Math.abs(x) < 0.15 && Math.abs(y) < 0.15) continue;
      // Avanza en la dirección de la vista (solo plano XZ), gira con X.
      camera.getWorldDirection(dir.current);
      dir.current.y = 0;
      dir.current.normalize();
      const speed = 2.2 * delta; // m/s — caminata cómoda
      camera.position.addScaledVector(dir.current, -y * speed);
      // Strafe lateral con el eje X del stick.
      const strafe = new THREE.Vector3(-dir.current.z, 0, dir.current.x);
      camera.position.addScaledVector(strafe, x * speed);
    }
  });
  return null;
}

/** Ref global al renderer para leer la sesión XR activa desde useFrame. */
const glXRSessionRef = { current: null as unknown };

/**
 * Menú en el controlador izquierdo: se mantiene frente al grip izquierdo y
 * ofrece "Salir de VR". Se activa apuntando con el ray y presionando trigger.
 */
function ExitMenuOnLeftController({ onExit }: { onExit: () => void }) {
  const [visible, setVisible] = useState(true);
  const controllers = useXR((s) => s.controllers);
  const left = controllers.find((c) => c.inputSource?.handedness === "left");
  const groupRef = useRef<THREE.Group>(null);

  // El panel sigue al grip del controlador izquierdo.
  useFrame(() => {
    if (!left || !groupRef.current) return;
    left.grip.getWorldPosition(groupRef.current.position);
    left.grip.getWorldQuaternion(groupRef.current.quaternion);
    groupRef.current.translateX(0.12);
    groupRef.current.translateY(0.05);
  });

  if (!left || !visible) return null;

  return (
    <group ref={groupRef} scale={0.35}>
      {/* marco del panel */}
      <mesh>
        <planeGeometry args={[0.62, 0.34]} />
        <meshBasicMaterial color="#0b0f14" transparent opacity={0.92} />
      </mesh>
      {/* título — Text de drei via lazy import dinámico no necesario: usamos
          un plano con color en vez de fuente para el MVP del menú. */}
      <mesh position={[-0.16, 0.08, 0.01]}>
        <planeGeometry args={[0.26, 0.08]} />
        <meshBasicMaterial color="#38bdf8" />
      </mesh>
      {/* botón SALIR — interactivo por ray del controlador derecho */}
      <Interactive
        onSelect={() => {
          onExit();
          setVisible(false);
        }}
      >
        <mesh position={[0, -0.06, 0.01]}>
          <planeGeometry args={[0.5, 0.14]} />
          <meshBasicMaterial color="#fb7185" />
        </mesh>
      </Interactive>
    </group>
  );
}

/** Maneja el fin de sesión XR para volver al lobby 2D limpio. */
function useExitVR() {
  return useCallback(() => {
    const session = glXRSessionRef.current as { end?: () => Promise<void> } | null;
    if (session?.end) {
      session.end().catch(() => undefined);
    }
  }, []);
}

function RoomCanvas({ sessionId, live }: { sessionId: string | null; live: ArtifactEvent[] }) {
  const glRef = useRef<unknown>(null);
  const vrSupport = useVRSupport();
  const [vrError, setVrError] = useState("");
  const [vrBusy, setVrBusy] = useState(false);
  const exitVR = useExitVR();

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

      <Canvas camera={{ position: [0, 2.2, 5.5], fov: 55 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={["#0b0f14"]} />
        <fog attach="fog" args={["#0b0f14", 8, 22]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 8, 4]} intensity={1.0} />

        <XR>
          <Ui3dSceneNodes scene={DEFAULT_ROOM} />
          <Ui3dSceneNodes scene={liveRoomScene(live)} />
          <ArtifactPanels sessionId={sessionId} live={live} />
          <ThumbstickLocomotion />
          <ExitMenuOnLeftController onExit={exitVR} />
          <Controllers />
          <Hands />
        </XR>

        <OrbitControls makeDefault target={[0, 1.2, 0]} maxPolarAngle={Math.PI / 2} />
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
        1.2 + (i % 2) * 0.4,
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
  return [...artifacts.values()].filter(isLiveComplete);
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