/**
 * stage/v2/WindowLayer.tsx — Places every open window where the current mode shows it.
 *
 * All open windows stay mounted (hidden ones are skipped by the renderer with content-visibility),
 * so switching modes, groups, panes or tabs never loses a window's scroll or state. In the Studio
 * each pane shows its active tab under the pane's row of tabs, with the pane chrome (the widget's
 * actions go to that row). In the Hub only the lámina has a rectangle; its close puts it down as a
 * card (the window stays open), and Explorar shows it bare. Everything else gets no rectangle.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";
import type { ArtifactEvent } from "../../lib/protocol";
import type { WorkspaceAPI } from "../../workspace/types";
import { isCompactPanel, type CanvasLayout, type Rect } from "../../workspace/layout";
import { ArtifactShell } from "./ArtifactShell";
import { WindowContentRouter } from "../WindowContentRouter";
import type { CanvasStateApi } from "./useCanvasState";
import type { WindowStatusApi } from "./useWindowStatus";
import { paneBody, type StudioLeaf } from "./Pane";
import { DetachButton } from "./Detach";

interface Props {
  api: WorkspaceAPI;
  canvas: CanvasStateApi;
  layout: CanvasLayout;
  status: WindowStatusApi;
  /** The Hub is on screen: it decides the one window seen. */
  hub?: { currentId: number | null; exploring: boolean; onPutDown: () => void; onExplore: () => void };
  /** The Studio is on screen: its panes, the hosts of their actions, and maximize. */
  studio?: { leaves: StudioLeaf[]; hosts: Record<string, HTMLElement | null>; onZoom: (leafId: string) => void };
}

export function WindowLayer({ api, canvas, layout, status, hub, studio }: Props) {
  const { t } = useTranslation();
  const { board } = canvas;

  // Rectangle (and compact flag) per window id for this frame.
  const placement = useMemo(() => {
    const map = new Map<number, { rect: Rect; compact: boolean; leaf?: string }>();
    if (board) return map;
    if (studio) {
      for (const l of studio.leaves) {
        if (l.activeId == null) continue;
        const rect = paneBody(l.rect, layout.k);
        map.set(l.activeId, { rect, compact: isCompactPanel(rect, layout.k), leaf: l.id });
      }
    } else if (hub && layout.lamina && hub.currentId != null) {
      map.set(hub.currentId, { rect: layout.lamina, compact: false });
    }
    return map;
  }, [studio, hub, layout.lamina, layout.k, board]);

  const detach = (id: number, artifactId?: string) => (artifactId ? <DetachButton canvas={canvas} id={id} /> : undefined);

  const open = api.windows.filter((w) => !w.closed);
  return (
    <div className="v2-window-layer" aria-label={t("canvas.aria_label") as string}>
      {open.map((w) => {
        const place = placement.get(w.id);
        const lamina = !!hub && w.id === hub.currentId;
        const ev = w.content as ArtifactEvent | null;
        const progress = ev && typeof ev === "object" && typeof ev.progress === "number" ? ev.progress : null;
        return (
          <ArtifactShell
            key={w.id}
            window={w}
            rect={place?.rect ?? null}
            z={w.zIndex}
            focused={!!place && w.focused}
            compact={place?.compact}
            chrome={place?.leaf ? "pane" : lamina && hub!.exploring ? "bare" : "window"}
            actionsHost={place?.leaf ? studio?.hosts[place.leaf] ?? null : undefined}
            lamina={lamina}
            status={status.status.get(w.id) ?? null}
            progress={progress}
            updatedAt={status.updatedAt(w.id)}
            onFocus={() => canvas.focusWindow(w.id)}
            onMinimize={() => (lamina ? hub!.onPutDown() : canvas.minimize(w.id))}
            onClose={() => (lamina ? hub!.onPutDown() : canvas.close(w.id))}
            onExpand={() => {
              if (lamina) { hub!.onExplore(); return; }
              if (place?.leaf) studio!.onZoom(place.leaf);
            }}
            closeLabel={lamina ? t("v2.hub.put_down") as string : undefined}
            headerActions={lamina ? (
              <>
                <button type="button" className="v2-icon-btn" title={`${t("v2.hub.explore")} · Ctrl ⇧ F`} aria-label={t("v2.hub.explore") as string}
                  onClick={(e) => { e.stopPropagation(); hub!.onExplore(); }}>
                  <Maximize2 size={16} aria-hidden="true" />
                </button>
                {detach(w.id, w.artifactId)}
              </>
            ) : place?.leaf ? undefined : detach(w.id, w.artifactId)}
          >
            <WindowContentRouter window={w} api={api} />
          </ArtifactShell>
        );
      })}
    </div>
  );
}
