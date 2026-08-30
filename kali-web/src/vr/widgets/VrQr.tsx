import { Container, Text, Image } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
import { parseContent } from "../../components/widgets/base/DataWidget";
export function VrQr({ ev }: { ev: ArtifactEvent }) {
  const { data } = parseContent(ev);
  const d = data as any;
  const url = typeof d === "string" ? d : (d?.url || d?.href || ev.content || "");
  const str = String(url).trim().slice(0, 256) || "https://example.com";
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(str)}`;
  return (
    <Container flexDirection="column" padding={12} gap={10} alignItems="center" backgroundColor="#0b0f14" borderRadius={8}>
      <Container width={160} height={160} backgroundColor="white" borderRadius={10} padding={6} alignItems="center" justifyContent="center">
        {/* @ts-ignore */}
        <Image src={qrSrc} width={148} height={148} />
      </Container>
      <Text fontSize={9} color="#22c55e" fontWeight={700}>QR</Text>
      <Text fontSize={8} color="#94a3b8">{str.slice(0, 56)}</Text>
    </Container>
  );
}
