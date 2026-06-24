/**
 * stage/ArtifactCanvas.tsx — The floating-window container layer.
 *
 * Renders all open windows from the workspace, manages focus + selection,
 * and provides context-menu + lasso infrastructure.  In mobile/grid mode,
 * windows are displayed in a scrollable flex-wrap grid instead of absolute
 * positioning.
 *
 * The actual widget content is rendered via a `WindowContentRouter` that
 * dispatches by window type using the widgetRegistry.
 */

import { useCallback } from "react";
import type { WorkspaceAPI } from "../workspace/types";
import { ArtifactWindow } from "./ArtifactWindow";
import { WindowContentRouter } from "./WindowContentRouter";
import { widgetRegistry } from "../components/widgets/widgetRegistry";

interface Props {
  api: WorkspaceAPI;
}

export function ArtifactCanvas({ api }: Props) {
  const { windows, gridMode, selectedIds, focusWindow, closeWindow, moveWindow, resizeWindow, toggleMinimize } = api;

  const handleMoveEnd = useCallback((id: number, prevPos: { x: number; y: number }) => {
    const w = windows.find((x) => x.id === id);
    if (!w) return;
    void prevPos;
  }, [windows]);

  if (gridMode) {
    return (
      <div className="artifact-layer-grid pointer-events-none" style={{ display: "flex", flexWrap: "wrap", gap: "16px", padding: "80px 20px 120px", alignItems: "flex-start", justifyContent: "center", alignContent: "flex-start" }}>
        {windows.filter((w) => !w.closed).map((w) => {
          const entry = widgetRegistry[w.type];
          return (
            <ArtifactWindow
              key={w.id}
              window={w}
              focused={w.focused}
              selected={selectedIds.has(w.id)}
              onFocus={() => focusWindow(w.id)}
              onClose={() => closeWindow(w.id)}
              onMinimize={() => toggleMinimize(w.id)}
              onMove={() => {}}
              onMoveEnd={() => {}}
              onResize={() => {}}
              minW={entry?.minW}
              minH={entry?.minH}
            >
              <WindowContentRouter window={w} />
            </ArtifactWindow>
          );
        })}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 30 }} aria-label="Capa de artefactos">
      {windows.filter((w) => !w.closed).map((w) => {
        const entry = widgetRegistry[w.type];
        return (
          <ArtifactWindow
            key={w.id}
            window={w}
            focused={w.focused}
            selected={selectedIds.has(w.id)}
            onFocus={() => focusWindow(w.id)}
            onClose={() => closeWindow(w.id)}
            onMinimize={() => toggleMinimize(w.id)}
            onMove={(pos) => moveWindow(w.id, pos)}
            onMoveEnd={(prevPos) => handleMoveEnd(w.id, prevPos)}
            onResize={(size) => resizeWindow(w.id, { width: size.width, height: w.size.height })}
            minW={entry?.minW}
            minH={entry?.minH}
          >
            <WindowContentRouter window={w} />
          </ArtifactWindow>
        );
      })}
    </div>
  );
}