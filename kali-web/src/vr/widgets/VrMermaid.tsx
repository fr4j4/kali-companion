import { Container, Text } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
import { parseContent } from "../../components/widgets/base/DataWidget";
export function VrMermaid({ ev }: { ev: ArtifactEvent }) {
  const { data } = parseContent(ev);
  const raw = ev.content ?? "";
  const code = typeof data === "string" ? data : raw;
  const preview = code.slice(0, 600);
  // Simple visual: show nodes as boxes
  const lines = code.split("\n").filter(l => l.includes("-->" ) || l.includes("-->")).slice(0, 4);
  return (
    <Container flexDirection="column" padding={10} gap={8} backgroundColor="#0f172a" borderRadius={8}>
      <Text fontSize={10} color="#a78bfa" fontWeight={700}>◈ mermaid</Text>
      {lines.length > 0 && (
        <Container flexDirection="column" gap={4} padding={8} backgroundColor="#1e293b" borderRadius={6}>
          {lines.map((l, i) => (
            <Container key={i} flexDirection="row" gap={6} alignItems="center">
              <Container width={8} height={8} backgroundColor="#a78bfa" borderRadius={4} />
              <Text fontSize={9} color="#e2e8f0">{l.trim().slice(0, 64)}</Text>
            </Container>
          ))}
        </Container>
      )}
      <Container backgroundColor="#020617" borderRadius={6} padding={8}>
        <Text fontSize={8} color="#cbd5e1" fontFamily="monospace">{preview.slice(0, 400)}</Text>
      </Container>
      <Text fontSize={8} color="#64748b">render SVG completo en 2D · VR muestra estructura</Text>
    </Container>
  );
}
