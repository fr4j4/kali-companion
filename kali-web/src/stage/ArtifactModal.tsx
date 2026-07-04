import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStage } from "./StageProvider";
import { Overlay } from "../components/ui/Overlay";
import { WINDOW_ICONS } from "../workspace/types";
import type { WorkspaceAPI } from "../workspace/types";

interface Props {
  open: boolean;
  onClose: () => void;
  api: WorkspaceAPI;
}

export function ArtifactModal({ open, onClose, api }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();

  const artifactList = useMemo(() => {
    return Array.from(chat.artifacts.values()).filter((a) => a.update !== "close" || a.phase === "complete");
  }, [chat.artifacts]);

  const handleFocus = (artifactId: string) => {
    const w = api.windows.find((win) => win.artifactId === artifactId);
    if (w && !w.closed) {
      api.focusWindow(w.id);
    } else if (w && w.closed) {
      api.reopenArtifact(artifactId);
    } else {
      api.reopenArtifact(artifactId);
    }
    onClose();
  };

  const count = artifactList.length;

  return (
    <Overlay
      open={open}
      onClose={onClose}
      variant="modal"
      size="xl"
      title={t("artifact.title")}
    >
      <div className="flex items-baseline gap-2 mb-4">
        {count > 0 && (
          <span className="badge text-muted">{count}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin -mx-5 -mb-5 p-4 space-y-2">
        {artifactList.length === 0 && (
          <p className="text-muted text-sm text-center py-8">
            {t("artifact.empty")}
          </p>
        )}
        {artifactList.map((art) => {
          const icon = WINDOW_ICONS[art.windowType as keyof typeof WINDOW_ICONS] || "📦";
          const win = api.windows.find((w) => w.artifactId === art.id);
          const isOpen = win != null && !win.closed;
          const preview =
            art.preview ??
            (art.content ? art.content.replace(/<[^>]+>/g, "").slice(0, 120) : "");
          return (
            <button
              key={art.id}
              onClick={() => handleFocus(art.id)}
              className="w-full text-left flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-border/50 hover:bg-white/[0.06] hover:border-accent/30 transition group cursor-pointer"
            >
              <span className="text-xl mt-0.5 shrink-0">{icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOpen ? "bg-ok" : "bg-muted/50"}`}
                    title={isOpen ? (t("artifact.open") as string) : (t("artifact.closed") as string)}
                  />
                  <span className="text-sm font-medium text-fg truncate">
                    {art.title || t("artifact.untitled")}
                  </span>
                  <span className="badge text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent uppercase shrink-0">
                    {art.windowType}
                  </span>
                </div>
                {preview && (
                  <p className="text-xs text-muted/70 line-clamp-2 leading-relaxed">
                    {preview}
                  </p>
                )}
              </div>
              <span className="text-muted/40 group-hover:text-fg/60 transition shrink-0 mt-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>
    </Overlay>
  );
}
