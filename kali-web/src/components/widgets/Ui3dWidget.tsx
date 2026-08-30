/**
 * Ui3dWidget — declarative 3D scene renderer (MVP slice 1 + slice 4 XR).
 *
 * Content contract (via parseContent on the widget artifact envelope):
 *   { elements: { [id]: { type, position?, rotation?, scale?, color?,
 *                         children? } },
 *     root?: string }          ← element id rendered as the scene root
 *
 * Element types (v0 catalog): box | sphere | group
 * Unknown types are skipped; groups nest their `children` ids (max 16 per
 * group, max depth 3) so a malformed scene can never explode the tree.
 *
 * VR (WebXR): the scene is wrapped in <XR>; an "Entrar en VR" button
 * (DOM overlay, outside the canvas) appears only when the browser reports
 * immersive-vr support via navigator.xr.isSessionSupported — e.g. the
 * Quest browser over HTTPS. Desktop browsers without WebXR simply never
 * see the button and keep OrbitControls.
 *
 * three/r3f/xr are code-split: this module is lazy-imported from
 * widgetRegistry, so the 3D chunk is only fetched when a ui3d artifact
 * actually exists (G1 bundle concern from the VR research report).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { XR, Controllers, Hands } from "@react-three/xr";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

/* ── scene schema (mirrors backend _UI3D_ELEMENTS in create_artifact.py) ── */

type Vec3 = [number, number, number];

interface Ui3dElement {
  type: "box" | "sphere" | "group";
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  color?: string;
  children?: string[];
}

interface Ui3dScene {
  elements: Record<string, Ui3dElement>;
  root?: string;
}

const MAX_GROUP_CHILDREN = 16;
const MAX_ROOT_CHILDREN = 32;
const MAX_DEPTH = 3;

function asVec3(v: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number")) {
    return v as Vec3;
  }
  return fallback;
}

function parseScene(raw: unknown): Ui3dScene {
  if (raw && typeof raw === "object") {
    const d = raw as Record<string, unknown>;
    if (d.elements && typeof d.elements === "object") {
      return d as unknown as Ui3dScene;
    }
  }
  return { elements: {} };
}

/* ── helpers ──────────────────────────────────────────────────── */

const PALETTE = ["#38bdf8", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#fb7185"];

function colorFor(id: string, explicit?: string): string {
  if (explicit && /^#[0-9a-fA-F]{3,8}$/.test(explicit)) return explicit;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function scaleOf(el?: Ui3dElement): Vec3 | number {
  if (typeof el?.scale === "number") return el.scale;
  return asVec3(el?.scale, [1, 1, 1]);
}

/* ── scene node ───────────────────────────────────────────────── */

function SceneNode({ id, scene, depth }: { id: string; scene: Ui3dScene; depth: number }) {
  const el = scene.elements?.[id];
  if (!el) return null;

  return (
    <group
      position={asVec3(el.position, [0, 0, 0])}
      rotation={asVec3(el.rotation, [0, 0, 0])}
      scale={scaleOf(el)}
    >
      {el.type === "box" && (
        <mesh>
          <boxGeometry />
          <meshStandardMaterial color={colorFor(id, el.color)} />
        </mesh>
      )}
      {el.type === "sphere" && (
        <mesh>
          <sphereGeometry args={[0.5, 32, 32]} />
          <meshStandardMaterial color={colorFor(id, el.color)} />
        </mesh>
      )}
      {el.type === "group" && depth < MAX_DEPTH && (
        (el.children ?? [])
          .filter((childId) => Boolean(scene.elements?.[childId]))
          .slice(0, MAX_GROUP_CHILDREN)
          .map((childId) => (
            <SceneNode key={childId} id={childId} scene={scene} depth={depth + 1} />
          ))
      )}
    </group>
  );
}

/* ── WebXR plumbing ───────────────────────────────────────────── */

type VRSupport = "checking" | "supported" | "unsupported";

function useVRSupport(): VRSupport {
  const [support, setSupport] = useState<VRSupport>("checking");
  useEffect(() => {
    const xr = (navigator as unknown as { xr?: {
      isSessionSupported?: (mode: string) => Promise<boolean>;
    } }).xr;
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

/** Bridges the r3f renderer (inside Canvas) to the DOM overlay button. */
function GLBridge({ glRef }: { glRef: React.MutableRefObject<unknown> }) {
  const { gl } = useThree();
  useEffect(() => {
    (gl as { xr: { enabled: boolean } }).xr.enabled = true;
    glRef.current = gl;
  }, [gl, glRef]);
  return null;
}

async function requestVRSession(gl: unknown): Promise<void> {
  const nav = navigator as unknown as { xr?: {
    requestSession: (mode: string, init?: Record<string, unknown>) => Promise<unknown>;
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
}

/* ── widget ───────────────────────────────────────────────────── */

export function Ui3dWidget({ content }: Props) {
  const { data } = useMemo(() => parseContent(content), [content]);
  const scene = useMemo(() => parseScene(data), [data]);
  const elementIds = Object.keys(scene.elements ?? {});

  const glRef = useRef<unknown>(null);
  const vrSupport = useVRSupport();
  const [vrError, setVrError] = useState("");
  const [vrBusy, setVrBusy] = useState(false);

  const enterVR = useCallback(async () => {
    setVrError("");
    setVrBusy(true);
    try {
      await requestVRSession(glRef.current);
      // Session granted; the headset owns rendering now.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVrError(msg);
    } finally {
      setVrBusy(false);
    }
  }, []);

  // Empty/invalid scene → friendly placeholder instead of a black canvas.
  if (elementIds.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="text-muted/60 text-xs leading-relaxed">
          <div className="text-2xl mb-2">🧊</div>
          Escena 3D vacía — pide a Kali una escena{" "}
          <code className="text-accent/80">ui3d</code> (cajas, esferas, grupos...)
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 min-h-0 w-full h-full ui3d-root">
      {vrSupport === "supported" && (
        <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={enterVR}
            disabled={vrBusy}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              vrBusy
                ? "border-muted/30 text-muted/50 cursor-wait"
                : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
            }`}
          >
            {vrBusy ? "Conectando..." : "🥽 Entrar en VR"}
          </button>
          {vrError && (
            <span className="max-w-52 text-right text-[10px] text-warn/80 leading-tight">
              {vrError}
            </span>
          )}
        </div>
      )}

      <Canvas
        camera={{ position: [4, 3, 5], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0b0f14"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} />

        <XR>
          {scene.root && scene.elements?.[scene.root] ? (
            <SceneNode id={scene.root} scene={scene} depth={0} />
          ) : (
            elementIds
              .filter((id) => scene.elements[id].type !== "group")
              .slice(0, MAX_ROOT_CHILDREN)
              .map((id) => <SceneNode key={id} id={id} scene={scene} depth={0} />)
          )}
          <Controllers />
          <Hands />
        </XR>

        <OrbitControls makeDefault />
        <GLBridge glRef={glRef} />
      </Canvas>
    </div>
  );
}