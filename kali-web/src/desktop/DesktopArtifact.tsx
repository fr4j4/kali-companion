import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchArtifact } from "../lib/artifacts";
import { WSClient } from "../lib/wsClient";
import type { ArtifactEvent } from "../lib/protocol";
import { resolveWindowType } from "../workspace/resolveWindowType";
import { createWindowData } from "../workspace/windowManager";
import { WindowContentRouter } from "../stage/WindowContentRouter";
import { websocketUrl } from "../lib/desktop";
import { StageProvider } from "../stage/StageProvider";
import { SidePanelProvider } from "../stage/SidePanelContext";

export function DesktopArtifact() {
  const { sid = "", aid = "" } = useParams();
  return <StageProvider detachedSessionId={sid}><DesktopArtifactContent sid={sid} aid={aid} /></StageProvider>;
}

function DesktopArtifactContent({ sid, aid }: { sid: string; aid: string }) {
  const [artifact, setArtifact] = useState<ArtifactEvent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sid || !aid) return;
    const controller = new AbortController();
    void fetchArtifact(sid, aid, controller.signal).then((value) => setArtifact({ event: "artifact", update: "create", ...value } as ArtifactEvent))
      .catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    const client = new WSClient(websocketUrl(), sid);
    client.on("artifact", (event) => {
      const item = event as ArtifactEvent;
      if (item.id !== aid) return;
      if (item.update === "close" && item.phase !== "complete") { setArtifact(null); return; }
      if (item.content != null) { setError(""); setArtifact(item); }
    });
    client.connect();
    return () => { controller.abort(); client.disconnect(); };
  }, [sid, aid]);
  if (error) return <main className="p-6 text-err">{error}</main>;
  if (!artifact) return <main className="p-6 text-muted">Cargando artefacto…</main>;
  const win = createWindowData({ type: resolveWindowType(artifact), title: artifact.title, artifactId: aid, content: artifact });
  return <main className="h-screen flex flex-col bg-bg text-fg">
    <header className="shrink-0 border-b border-border px-4 py-3 font-semibold">{artifact.title}</header>
    <section className="flex-1 min-h-0 overflow-auto"><SidePanelProvider><WindowContentRouter window={win} /></SidePanelProvider></section>
  </main>;
}
