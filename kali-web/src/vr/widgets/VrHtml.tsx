import { Container, Text } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
export function VrHtml({ ev }: { ev: ArtifactEvent }) {
  const raw = ev.content ?? "";
  const isHtml = raw.trim().startsWith("<");
  if (!isHtml) {
    return <Container flexDirection="column" padding={10} gap={6} backgroundColor="#0b0f14" borderRadius={8}><Text fontSize={10} color="#94a3b8">{ev.title || "html"} · texto</Text><Text fontSize={10} color="#e2e8f0">{raw.slice(0, 600)}</Text></Container>;
  }
  const tmp = document.createElement("div"); tmp.innerHTML = raw;
  const h1 = tmp.querySelector("h1")?.textContent?.slice(0, 60);
  const ps = Array.from(tmp.querySelectorAll("p")).map(p => p.textContent?.slice(0, 140)).filter(Boolean).slice(0, 3) as string[];
  const lis = Array.from(tmp.querySelectorAll("li")).map(li => li.textContent?.slice(0, 80)).filter(Boolean).slice(0, 4) as string[];
  const code = tmp.querySelector("code")?.textContent?.slice(0, 80);
  const buttons = Array.from(tmp.querySelectorAll("button")).map(b => b.textContent?.trim().slice(0, 24)).filter(Boolean).slice(0, 3) as string[];
  const imgSrc = tmp.querySelector("img")?.getAttribute("src")?.slice(0, 256) || "";
  const links = Array.from(tmp.querySelectorAll("a")).map(a => ({ text: a.textContent?.trim().slice(0, 32) || a.getAttribute("href")?.slice(0, 32) || "link", href: a.getAttribute("href") || "" })).slice(0, 2);
  return (
    <Container flexDirection="column" gap={8} padding={10} backgroundColor="white" borderRadius={8} overflow="scroll" scrollbarWidth={3} maxHeight={300}>
      <Container flexDirection="column" gap={4}>
        {h1 && <Text fontSize={14} color="#0ea5e9" fontWeight={700}>{h1}</Text>}
        {ps.map((p, i) => <Text key={i} fontSize={10} color="#1e293b">{p}</Text>)}
        {lis.length > 0 && <Container flexDirection="column" gap={2} marginTop={4}>{lis.map((li, i) => <Container key={i} flexDirection="row" gap={6}><Text fontSize={10} color="#64748b">•</Text><Text fontSize={10} color="#334155">{li}</Text></Container>)}</Container>}
        {code && <Container marginTop={6} padding={8} backgroundColor="#f1f5f9" borderRadius={6}><Text fontSize={9} color="#0f172a">{code}</Text></Container>}
        {imgSrc && <Container width="100%" height={120} backgroundColor="#f1f5f9" borderRadius={6} overflow="hidden" marginTop={6}><Container width="100%" height="100%" backgroundColor="#e2e8f0" alignItems="center" justifyContent="center"><Text fontSize={8} color="#64748b">[imagen html] {imgSrc.slice(0, 48)}</Text></Container></Container>}
        {links.length > 0 && <Container flexDirection="column" gap={4} marginTop={6}>{links.map((l, i) => <Container key={i} flexDirection="row" gap={6} alignItems="center"><Text fontSize={9} color="#0ea5e9">{l.text}</Text><Text fontSize={8} color="#94a3b8">{l.href.slice(0, 40)}</Text></Container>)}</Container>}
        {buttons.length > 0 && <Container flexDirection="row" gap={8} marginTop={8}>{buttons.map((b, i) => <Container key={i} backgroundColor="#0ea5e9" padding={8} borderRadius={6} hover={{ backgroundColor: "#0284c7" }} onClick={() => console.log("[VrHtml] button", b)}><Text fontSize={10} color="white">{b}</Text></Container>)}</Container>}
      </Container>
      <Text fontSize={8} color="#64748b">scroll disponible · grip para mover</Text>
    </Container>
  );
}
