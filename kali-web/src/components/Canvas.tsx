import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ArtifactEvent } from "../lib/protocol";
import { HtmlArtifact } from "./artifacts/HtmlArtifact";
import { MarkdownArtifact } from "./artifacts/MarkdownArtifact";
import { DiffArtifact } from "./artifacts/DiffArtifact";
import { WidgetGrid } from "./artifacts/WidgetGrid";

interface Props {
  artifacts: Map<string, ArtifactEvent>;
  collapsed: boolean;
  onToggle: () => void;
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}

export function Canvas({ artifacts, collapsed, onToggle, imageReadyKeys, onRequestImage }: Props) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);

  const artifactList = Array.from(artifacts.values());
  const activeArtifact = activeId ? artifacts.get(activeId) : artifactList[artifactList.length - 1] ?? null;

  return (
    <aside className={`w-[420px] shrink-0 border-l border-border bg-elevated flex flex-col overflow-hidden relative transition-[width] duration-200 ${collapsed ? "w-0 min-w-0 border-l-0 overflow-hidden" : ""}`}>
      <div className="p-3 border-b border-border flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted flex-1">{t("canvas.title")}</span>
          <button className="bg-transparent border border-border text-muted rounded-md px-1.5 py-0.5 text-xs cursor-pointer leading-none hover:bg-surface transition-colors" onClick={onToggle} aria-label="Toggle canvas">
            ▶
          </button>
        </div>
        {artifactList.length > 1 && (
          <div className="canvas-tabs">
            {artifactList.map((a) => (
              <button
                key={a.id}
                className={`canvas-tab ${a.id === (activeArtifact?.id ?? "") ? "active" : ""}`}
                onClick={() => setActiveId(a.id)}
              >
                {a.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto relative">
        {activeArtifact && (
          activeArtifact.type === "html" ? <HtmlArtifact content={activeArtifact.content} /> :
          activeArtifact.type === "markdown" ? <MarkdownArtifact content={activeArtifact.content} /> :
          activeArtifact.type === "diff" ? <DiffArtifact content={activeArtifact.content} /> :
          activeArtifact.type === "widget" ? <WidgetGrid content={activeArtifact.content} imageReadyKeys={imageReadyKeys} onRequestImage={onRequestImage} /> :
          <div className="flex flex-col items-center justify-center h-full text-muted gap-3 p-5 text-center"><p>{t("canvas.unsupported")}</p></div>
        )}
        {!activeArtifact && (
          <div className="flex flex-col items-center justify-center h-full text-muted gap-3 p-5 text-center">
            <span className="text-5xl">🎨</span>
            <p>{t("canvas.empty")}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
