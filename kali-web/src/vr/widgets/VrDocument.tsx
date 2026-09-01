import { Container, Text } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
import { parseContent } from "../../components/widgets/base/DataWidget";
import { renderMarkdown } from "../../lib/markdown";

export function VrDocument({ ev }: { ev: ArtifactEvent }) {
  const { data } = parseContent(ev);
  const raw = ev.content ?? "";
  const txt = typeof data === "string" ? data : (data as any)?.content ? String((data as any).content) : raw;
  // renderMarkdown -> HTML string with h1..h3, p, ul/li, blockquote, pre/code
  let html = "";
  try { html = renderMarkdown(txt); } catch { html = `<p>${txt.slice(0, 1200)}</p>`; }
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const blocks: Array<{ type: string; text: string }> = [];
  tmp.childNodes.forEach((n: any) => {
    if (n.nodeType === 1) {
      const tag = (n.tagName as string).toLowerCase();
      const text = (n.textContent || "").trim().slice(0, 300);
      if (!text) return;
      if (["h1", "h2", "h3", "h4"].includes(tag)) blocks.push({ type: "h", text });
      else if (tag === "blockquote") blocks.push({ type: "quote", text });
      else if (tag === "pre") blocks.push({ type: "code", text: n.textContent?.slice(0, 400) || "" });
      else if (tag === "ul" || tag === "ol") {
        Array.from(n.querySelectorAll("li")).slice(0, 6).forEach((li: any) => {
          const t = (li.textContent || "").trim().slice(0, 120);
          if (t) blocks.push({ type: "li", text: t });
        });
      } else blocks.push({ type: "p", text: text.slice(0, 280) });
    }
  });
  if (blocks.length === 0) {
    const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
    blocks.push({ type: "p", text: stripped });
  }
  return (
    <Container flexDirection="column" padding={10} gap={6}>
      <Text fontSize={9} color="#94a3b8" fontWeight={700}>{ev.title || "document"} · markdown{ev.phase === "streaming" ? " ▌" : ""}</Text>
      <Text fontSize={8} color="#64748b">prueba tildes: áéíóú ñ ü ¿cómo estás? — Kali VR</Text>
      {blocks.slice(0, 10).map((b, i) => {
        if (b.type === "h") return <Text key={i} fontSize={13} color="#38bdf8" fontWeight={700}>{b.text}</Text>;
        if (b.type === "quote") return <Container key={i} borderLeftWidth={3} borderColor="#38bdf8" paddingLeft={8} marginLeft={4}><Text fontSize={10} color="#94a3b8">{b.text}</Text></Container>;
        if (b.type === "code") return <Container key={i} backgroundColor="#020617" borderRadius={6} padding={8}><Text fontSize={9} color="#22c55e" fontFamily="monospace">{b.text.slice(0, 200)}</Text></Container>;
        if (b.type === "li") return <Container key={i} flexDirection="row" gap={6} paddingLeft={6}><Text fontSize={10} color="#38bdf8">•</Text><Text fontSize={10} color="#e2e8f0">{b.text}</Text></Container>;
        return <Text key={i} fontSize={10} color="#cbd5e1">{b.text}</Text>;
      })}
    </Container>
  );
}
