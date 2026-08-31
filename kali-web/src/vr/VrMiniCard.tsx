import { useMemo } from "react";
import { Interactive } from "@react-three/xr";
import { Text } from "@react-three/drei";

type Props = {
  title: string;
  windowType: string;
  summary: string;
  slot: number;
  onRestore: () => void;
};

/** Color dot por tipo (mismo mapa que el header del panel). */
export const TYPE_COLORS: Record<string, string> = {
  html: "#f59e0b", document: "#38bdf8", code: "#a78bfa", json: "#fbbf24",
  table: "#22d3ee", checklist: "#34d399", chart: "#22d3ee", mermaid: "#a78bfa",
  qr: "#10b981", link: "#60a5fa", image: "#8b5cf6", media: "#8b5cf6",
  entity: "#f472b6", resource: "#fb7185", place: "#f97316", terminal: "#22c55e",
  diff: "#eab308", quiz: "#a78bfa", reasoning: "#94a3b8", game: "#f43f5e",
  controls: "#64748b", widget: "#64748b", ui3d: "#38bdf8",
};

/**
 * Mini-card: panel colapsado a 0.30×0.10 m. Pinch (trigger) restaura.
 * Se acomoda en una grilla 3×N bajo el abanico principal.
 */
export function VrMiniCard({ title, windowType, summary, slot, onRestore }: Props) {
  const pos = useMemo(() => {
    const col = slot % 3;
    const row = Math.floor(slot / 3);
    return [ (col - 1) * 0.36, 1.05 - row * 0.14, -1.1 ] as [number, number, number];
  }, [slot]);
  const dotColor = TYPE_COLORS[windowType] ?? "#64748b";
  return (
    <Interactive onSelect={onRestore}>
      <group position={pos}>
        <mesh>
          <planeGeometry args={[0.32, 0.1]} />
          <meshBasicMaterial color="#111827" transparent opacity={0.96} />
        </mesh>
        <mesh position={[-0.13, 0, 0.002]}>
          <circleGeometry args={[0.012, 16]} />
          <meshBasicMaterial color={dotColor} />
        </mesh>
        <Text position={[-0.1, 0.018, 0.002]} fontSize={0.018} color="#e2e8f0" anchorX="left" anchorY="middle" maxWidth={0.28} clipRect={[-0.15, -0.028, 0.15, 0.028] as unknown as [number, number, number, number]}>
          {title.slice(0, 22)}
        </Text>
        <Text position={[-0.1, -0.016, 0.002]} fontSize={0.013} color="#64748b" anchorX="left" anchorY="middle" maxWidth={0.28} clipRect={[-0.15, -0.028, 0.15, 0.028] as unknown as [number, number, number, number]}>
          {`${windowType} · ${summary}`}
        </Text>
        <group position={[0.135, 0, 0.003]}>
          <Text fontSize={0.02} color="#38bdf8" anchorX="center" anchorY="middle">⤢</Text>
        </group>
      </group>
    </Interactive>
  );
}
