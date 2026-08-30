import { Container, Text, Image } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
import { parseContent } from "../../components/widgets/base/DataWidget";
export function VrImage({ ev }: { ev: ArtifactEvent }) {
  const { data } = parseContent(ev);
  const d = data as any;
  const url = (d?.url || d?.src || d?.image || ev.content || "") as string;
  const caption = d?.caption ? String(d.caption) : "";
  const clean = String(url).trim();
  const isUrl = clean.startsWith("http") || clean.startsWith("data:");
  // picsum a veces tarda/CORS; uikit Image carga async — mostramos url como respaldo siempre
  return (
    <Container flexDirection="column" padding={8} gap={8} alignItems="center">
      {isUrl ? (
        <Container width="100%" height={200} borderRadius={8} overflow="hidden" backgroundColor="#020617" borderWidth={1} borderColor="#334155">
          {/* @ts-ignore uikit Image src — carga textura externa; si falla queda fondo oscuro + url debajo */}
          <Image src={clean} width="100%" height="100%" objectFit="cover" />
        </Container>
      ) : (
        <Container width="100%" height={180} backgroundColor="#1e293b" borderRadius={8} alignItems="center" justifyContent="center">
          <Text fontSize={10} color="#94a3b8">[imagen] {clean.slice(0, 44) || "(sin url)"}</Text>
        </Container>
      )}
      <Text fontSize={8} color="#64748b">{clean.slice(0, 72)}</Text>
      {caption && <Text fontSize={10} color="#e2e8f0">{caption.slice(0, 80)}</Text>}
    </Container>
  );
}
