/**
 * stage/v2/WindowLayer.tsx — Places every open window in its zone for the current mode.
 *
 * All open windows stay mounted (hidden ones are skipped by the renderer with content-visibility),
 * so switching modes, groups or tabs never loses a window's scroll or state. Each window gets a
 * rectangle from the zone model: cascaded in split, the tab in focus and fullscreen, a panel in
 * mosaic, and nothing (hidden) while it waits in the tray or another group is on screen.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import type { ArtifactEvent } from "../../lib/protocol";
import type { WorkspaceAPI } from "../../workspace/types";
import { cascadeSlots, defaultPreset, isCompactPanel, mosaicLayout, PRESET_PANELS, type CanvasLayout, type Rect } from "../../workspace/layout";
import { ArtifactShell } from "./ArtifactShell";
import { WindowContentRouter } from "../WindowContentRouter";
import type { CanvasStateApi } from "./useCanvasState";
import type { WindowStatusApi } from "./useWindowStatus";

interface Props {
  api: WorkspaceAPI;
  canvas: CanvasStateApi;
  layout: CanvasLayout;
  status: WindowStatusApi;
}

/** Which window ids sit in which mosaic panel. */
export function mosaicAssignment(tabIds: number[], panelIds: number[], preset: keyof typeof PRESET_PANELS | null) {
  const p = preset ?? defaultPreset(Math.min(4, tabIds.length));
  const want = Math.min(PRESET_PANELS[p], tabIds.length);
  const chosen = panelIds.filter((id) => tabIds.includes(id)).slice(0, want);
  for (const id of tabIds) { if (chosen.length >= want) break; if (!chosen.includes(id)) chosen.push(id); }
  return { preset: chosen.length < PRESET_PANELS[p] ? defaultPreset(chosen.length) : p, ids: chosen };
}

export function WindowLayer({ api, canvas, layout, status }: Props) {
  const { t } = useTranslation();
  const { active, mode: groupMode, visibleIds, tabIds, panel, space } = canvas;

  const effMode = layout.mode;
  const zone = layout.artifact;

  // Rectangle (and compact flag) per window id for this frame.
  const placement = useMemo(() => {
    const map = new Map<number, { rect: Rect; compact: boolean }>();
    if (!zone || space || (panel && effMode === "split") || !active) return { map, preset: null as null | string };
    if (effMode === "split") {
      const slots = cascadeSlots(zone, visibleIds.length, layout.wide);
      visibleIds.forEach((id, i) => map.set(id, { rect: slots[i], compact: false }));
    } else if (effMode === "focus" || effMode === "fullscreen") {
      const id = active.activeId != null && tabIds.includes(active.activeId) ? active.activeId : tabIds[0];
      if (id != null) map.set(id, { rect: zone, compact: false });
    } else if (effMode === "mosaic") {
      const { preset, ids } = mosaicAssignment(tabIds, active.mosaic.panelIds, active.mosaic.preset);
      const m = mosaicLayout(zone, preset, active.mosaic.ratios, layout.k);
      ids.forEach((id, i) => { if (m.panels[i]) map.set(id, { rect: m.panels[i], compact: isCompactPanel(m.panels[i], layout.k) }); });
      return { map, preset };
    }
    return { map, preset: null };
  }, [zone, space, panel, effMode, active, visibleIds, tabIds, layout.wide, layout.k]);

  const detach = (artifactId?: string) => window.kaliDesktop && artifactId ? (
    <button type="button" className="v2-icon-btn" title={t("window.detach_hint") as string} aria-label={t("window.detach") as string}
      onClick={(e) => { e.stopPropagation(); const sid = localStorage.getItem("kali.sessionId"); if (sid) void window.kaliDesktop?.openArtifact(sid, artifactId); }}>
      <ExternalLink size={15} aria-hidden="true" />
    </button>
  ) : undefined;

  const open = api.windows.filter((w) => !w.closed);
  return (
    <div className="v2-window-layer" aria-label={t("canvas.aria_label") as string}>
      {open.map((w) => {
        const place = placement.map.get(w.id);
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
            chrome={effMode === "fullscreen" ? "bare" : "window"}
            status={status.status.get(w.id) ?? null}
            progress={progress}
            updatedAt={status.updatedAt(w.id)}
            onFocus={() => canvas.focusWindow(w.id)}
            onMinimize={() => canvas.minimize(w.id)}
            onClose={() => canvas.close(w.id)}
            onExpand={() => { canvas.focusWindow(w.id); canvas.setMode(groupMode === "focus" ? "split" : "focus"); }}
            headerActions={detach(w.artifactId)}
          >
            <WindowContentRouter window={w} api={api} />
          </ArtifactShell>
        );
      })}
    </div>
  );
}
