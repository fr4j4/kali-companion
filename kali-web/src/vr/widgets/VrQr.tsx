import { Container, Text } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
import { parseContent } from "../../components/widgets/base/DataWidget";
export function VrQr({ev}:{ev:ArtifactEvent}){
  const {data}=parseContent(ev); const d=data as any; const url=typeof d==="string"?d:(d?.url||d?.href||ev.content||"");
  const str=String(url).slice(0,64);
  return (
    <Container flexDirection="column" padding={12} gap={10} alignItems="center" backgroundColor="#0b0f14" borderRadius={8}>
      <Container width={140} height={140} backgroundColor="white" borderRadius={10} borderWidth={2} borderColor="#020617" alignItems="center" justifyContent="center" padding={8}>
        <Container width={110} height={110} backgroundColor="#111" borderRadius={4} alignItems="center" justifyContent="center">
          <Text fontSize={28} color="white">QR</Text>
        </Container>
      </Container>
      <Text fontSize={9} color="#38bdf8" textAlign="center">{str}</Text>
      <Text fontSize={8} color="#64748b">escanea en canvas 2D para URL real</Text>
    </Container>
  );
}
