import { Container, Text } from "@react-three/uikit";
import type { ArtifactEvent } from "../../lib/protocol";
import { VrTable } from "./VrTable";
import { VrChecklist } from "./VrChecklist";
import { VrCode } from "./VrCode";
import { VrDocument } from "./VrDocument";
import { VrChart } from "./VrChart";
import { VrJson } from "./VrJson";
import { VrTerminal } from "./VrTerminal";
import { VrMermaid } from "./VrMermaid";
import { VrQr } from "./VrQr";
import { VrLink } from "./VrLink";
import { VrImage } from "./VrImage";
import { VrEntity } from "./VrEntity";
import { VrQuiz } from "./VrQuiz";
import { VrHtml } from "./VrHtml";

type Props = { ev: ArtifactEvent; onAction?: (type: string, payload?: unknown) => void };

function Fallback({ ev }: { ev: ArtifactEvent }) {
  return (
    <Container flexDirection="column" padding={10} gap={6} backgroundColor="#0f172a" borderRadius={6}>
      <Text fontSize={11} color="#94a3b8">{ev.title || ev.windowType} · {ev.windowType}</Text>
      <Text fontSize={12} color="#e2e8f0">{(ev.content ?? "").slice(0, 400) || "(vacío)"}</Text>
    </Container>
  );
}

export function VrWidgetRenderer({ ev, onAction }: Props) {
  const wt = ev.windowType as string;
  switch (wt) {
    case "table": return <VrTable ev={ev} />;
    case "checklist": return <VrChecklist ev={ev} onAction={onAction} />;
    case "code": return <VrCode ev={ev} />;
    case "document": return <VrDocument ev={ev} />;
    case "reasoning": return <VrDocument ev={ev} />;
    case "chart": return <VrChart ev={ev} />;
    case "json": return <VrJson ev={ev} />;
    case "terminal": return <VrTerminal ev={ev} />;
    case "diff": return <VrCode ev={ev} />;
    case "mermaid": return <VrMermaid ev={ev} />;
    case "qr": return <VrQr ev={ev} />;
    case "link": return <VrLink ev={ev} />;
    case "image": return <VrImage ev={ev} />;
    case "media": return <VrImage ev={ev} />;
    case "entity": return <VrEntity ev={ev} />;
    case "resource": return <VrEntity ev={ev} />;
    case "place": return <VrEntity ev={ev} />;
    case "quiz": return <VrQuiz ev={ev} onAction={onAction} />;
    case "html": return <VrHtml ev={ev} />;
    case "controls": return <Fallback ev={ev} />;
    case "widget": return <Fallback ev={ev} />;
    case "game": return <Fallback ev={ev} />;
    default: return <Fallback ev={ev} />;
  }
}
