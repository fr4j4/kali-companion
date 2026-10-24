import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStage } from "./StageProvider";
import { Overlay } from "../components/ui/Overlay";
import { StateMessage } from "../components/ui/StateMessage";
import { WINDOW_ICONS } from "../workspace/types";
import type { WindowType, WorkspaceAPI } from "../workspace/types";
import { WindowTypeIcon } from "./windowIcons";

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

  const [query, setQuery] = useState("");
  const previewOf = (art: (typeof artifactList)[number]) => {
    const raw = art.preview ?? (art.content ? art.content.replace(/<[^>]+>/g, "") : "");
    return raw.replace(/[#*>`_]+/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
  };
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return artifactList;
    return artifactList.filter((a) => `${a.title} ${a.windowType} ${previewOf(a)}`.toLowerCase().includes(q));
    // previewOf is a pure helper over `a`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactList, query]);
  const count = artifactList.length;

  return (
    <Overlay
      open={open}
      onClose={onClose}
      variant="modal"
      size="xl"
      title={count > 0 ? `${t("artifact.title")} · ${count}` : t("artifact.title")}
    >
      <div className="-mx-5 -mb-5 flex min-h-0 flex-1 flex-col">
        {count > 4 && (
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/50 px-3 py-2 focus-within:border-accent/60">
              <Search size={14} className="text-muted" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("artifact.search") as string}
                aria-label={t("artifact.search") as string}
                className="flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
              />
            </div>
          </div>
        )}
        <div className="grid flex-1 content-start gap-3 overflow-y-auto scrollbar-thin p-5 pt-2 md:grid-cols-2">
          {count === 0 && (
            <StateMessage kind="empty" title={t("artifact.empty") as string} className="py-10 md:col-span-2" />
          )}
          {count > 0 && filtered.length === 0 && (
            <StateMessage kind="empty" title={t("artifact.no_matches") as string} className="py-10 md:col-span-2" />
          )}
          {filtered.map((art) => {
            const win = api.windows.find((w) => w.artifactId === art.id);
            const isOpen = win != null && !win.closed;
            const preview = previewOf(art);
            return (
              <button
                key={art.id}
                onClick={() => handleFocus(art.id)}
                className="group flex min-h-[92px] w-full cursor-pointer flex-col gap-2 rounded-xl border border-border bg-fg/[0.02] p-3.5 text-left transition hover:border-accent/50 hover:bg-fg/[0.05]"
              >
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <WindowTypeIcon type={(art.windowType as WindowType) in WINDOW_ICONS ? (art.windowType as WindowType) : "widget"} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{art.title || t("artifact.untitled")}</span>
                    <span className="block text-[11px] capitalize text-muted">{art.windowType}</span>
                  </span>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${isOpen ? "bg-ok/15 text-ok" : "bg-fg/5 text-muted"}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? "bg-ok" : "bg-muted/60"}`} />
                    {isOpen ? t("artifact.open") : t("artifact.closed")}
                  </span>
                </span>
                {preview && <span className="line-clamp-2 text-xs leading-relaxed text-muted">{preview}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </Overlay>
  );
}
