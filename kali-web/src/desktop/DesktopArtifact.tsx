import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { StateMessage } from "../components/ui/StateMessage";

export function DesktopArtifact() {
  const { sid = "", aid = "" } = useParams();
  return <StageProvider detachedSessionId={sid}><DesktopArtifactContent sid={sid} aid={aid} /></StageProvider>;
}

function DesktopArtifactContent({ sid, aid }: { sid: string; aid: string }) {
  const { t } = useTranslation();
  const [artifact, setArtifact] = useState<ArtifactEvent | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Desktop: back to its tab in Kali. Browser (a tab opened from the canvas): just close the tab.
  const desktop = !!window.kaliDesktop;
  const back = useCallback(() => {
    if (window.kaliDesktop) void window.kaliDesktop.returnArtifact(sid, aid);
    else window.close();
  }, [sid, aid]);
  useEffect(() => {
    if (!sid || !aid) return;
    const controller = new AbortController();
    setError("");
    void fetchArtifact(sid, aid, controller.signal).then((value) => { setArtifact({ event: "artifact", update: "create", ...value } as ArtifactEvent); setUpdatedAt(Date.now()); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); });
    const client = new WSClient(websocketUrl(), sid);
    client.on("artifact", (event) => {
      const item = event as ArtifactEvent;
      if (item.id !== aid) return;
      if (item.update === "close" && item.phase !== "complete") { setArtifact(null); return; }
      if (item.content != null) { setError(""); setArtifact(item); setUpdatedAt(Date.now()); }
    });
    client.connect();
    return () => { controller.abort(); client.disconnect(); };
  }, [sid, aid, attempt]);
  // In a browser tab the page names itself; on the desktop the shell's window title stays (window rules match it).
  const title = artifact?.title;
  useEffect(() => { if (!window.kaliDesktop && title) document.title = `${title} · Kali`; }, [title]);
  // Esc sends the artifact back to the canvas, like closing a native dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) back(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  if (!artifact) {
    return <main className="h-screen flex items-center justify-center bg-bg text-fg">
      {error
        ? <StateMessage kind="error" title={t("desktop.artifact_error")} detail={error}>
            <button className="rounded border border-border px-3 py-1 text-xs hover:bg-elevated" onClick={() => setAttempt((n) => n + 1)}>{t("desktop.retry")}</button>
            <button className="rounded border border-border px-3 py-1 text-xs text-muted hover:text-fg" onClick={back}>{t("desktop.close")}</button>
          </StateMessage>
        : <StateMessage kind="loading" title={t("desktop.loading_artifact")} />}
    </main>;
  }
  const win = createWindowData({ type: resolveWindowType(artifact), title: artifact.title, artifactId: aid, content: artifact });
  const streaming = artifact.phase === "streaming";
  const text = typeof artifact.content === "string" ? artifact.content : "";
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  };
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  // No canvas frame: the OS window has the title; a thin bar at the foot has the state, the time and the way back.
  return <main className="h-screen flex flex-col bg-bg text-fg">
    {/* Widgets are written for a flex-column parent (as in the canvas window body): without it
        flex-1 children such as the HTML preview iframe collapse to their intrinsic height. */}
    <section className="flex-1 min-h-0 flex flex-col overflow-hidden"><SidePanelProvider><WindowContentRouter window={win} /></SidePanelProvider></section>
    <footer className="shrink-0 flex items-center gap-3 border-t border-border px-3 h-9 text-xs text-muted">
      {streaming
        ? <span className="shrink-0 inline-flex items-center gap-1 text-accent" role="status">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />{t("desktop.live")}
          </span>
        : time && <span className="shrink-0">{t("desktop.updated_at", { time })}</span>}
      <span className="min-w-0 truncate">{artifact.title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {text && <button className="rounded px-2 py-0.5 hover:text-fg hover:bg-elevated" onClick={copy}>
          {copied ? t("desktop.copied") : t("desktop.copy")}
        </button>}
        <button className="rounded border border-border px-2 py-0.5 text-fg hover:bg-elevated"
          title={(desktop ? t("desktop.return_to_canvas_hint") : t("desktop.close_tab")) as string}
          onClick={back}>
          {desktop ? t("desktop.return_to_canvas") : t("desktop.close_tab")}
        </button>
      </div>
    </footer>
  </main>;
}
