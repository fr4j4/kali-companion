/**
 * Ui3dWidget — declarative 3D scene renderer (MVP slice 1).
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
 * three/r3f are code-split: this module is lazy-imported from
 * widgetRegistry, so the 3D chunk is only fetched when a ui3d artifact
 * actually exists (G1 bundle concern from the VR research report).
 */
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
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

/* ── widget ───────────────────────────────────────────────────── */

export function Ui3dWidget({ content }: Props) {
  const { data } = useMemo(() => parseContent(content), [content]);
  const scene = useMemo(() => parseScene(data), [data]);

  const elementIds = Object.keys(scene.elements ?? {});

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
    <div className="flex flex-1 min-h-0 w-full h-full ui3d-root">
      <Canvas
        camera={{ position: [4, 3, 5], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0b0f14"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} />

        {scene.root && scene.elements?.[scene.root] ? (
          <SceneNode id={scene.root} scene={scene} depth={0} />
        ) : (
          elementIds
            .filter((id) => scene.elements[id].type !== "group")
            .slice(0, MAX_ROOT_CHILDREN)
            .map((id) => <SceneNode key={id} id={id} scene={scene} depth={0} />)
        )}

        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}