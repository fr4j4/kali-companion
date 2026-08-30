import { Container, Text } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
export function VrHtml({ev}:{ev:ArtifactEvent}){
  const raw=ev.content??"";
  const isHtml=raw.trim().startsWith("<");
  if(!isHtml){
    return <Container flexDirection="column" padding={10} gap={6} backgroundColor="#0b0f14" borderRadius={8}><Text fontSize={10} color="#94a3b8">{ev.title||"html"} · texto</Text><Text fontSize={10} color="#e2e8f0">{raw.slice(0,600)}</Text></Container>;
  }
  // Parse simple: extract h1/p/li/code
  const tmp=document.createElement("div"); tmp.innerHTML=raw;
  const h1=tmp.querySelector("h1")?.textContent?.slice(0,60);
  const ps=Array.from(tmp.querySelectorAll("p")).map(p=>p.textContent?.slice(0,120)).filter(Boolean).slice(0,3);
  const lis=Array.from(tmp.querySelectorAll("li")).map(li=>li.textContent?.slice(0,80)).filter(Boolean).slice(0,4);
  const code=tmp.querySelector("code")?.textContent?.slice(0,80);
  return (
    <Container flexDirection="column" gap={8} padding={10} backgroundColor="white" borderRadius={8}>
      <Container flexDirection="column" gap={4}>
        {h1 && <Text fontSize={14} color="#0ea5e9" fontWeight={700}>{h1}</Text>}
        {ps.map((p,i)=><Text key={i} fontSize={10} color="#1e293b">{p}</Text>)}
        {lis.length>0 && <Container flexDirection="column" gap={2} marginTop={4}>
          {lis.map((li,i)=><Container key={i} flexDirection="row" gap={6}><Text fontSize={10} color="#64748b">•</Text><Text fontSize={10} color="#334155">{li}</Text></Container>)}
        </Container>}
        {code && <Container marginTop={6} padding={8} backgroundColor="#f1f5f9" borderRadius={6}><Text fontSize={9} color="#0f172a" fontFamily="monospace">{code}</Text></Container>}
      </Container>
      <Container marginTop={6} padding={6} backgroundColor="#f8fafc" borderRadius={6} borderWidth={1} borderColor="#e2e8f0">
        <Text fontSize={8} color="#64748b">preview fiel · tap grip para mover · modo codigo disponible en 2D</Text>
      </Container>
    </Container>
  );
}
