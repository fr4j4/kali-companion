import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceAPI } from "../workspace/types";
import { ArtifactWindow } from "./ArtifactWindow";
import { WindowContentRouter } from "./WindowContentRouter";
import { widgetRegistry } from "../components/widgets/widgetRegistry";

interface Props {
  api: WorkspaceAPI;
  winScale?: number;
}

export function ArtifactCanvas({ api, winScale = 1 }: Props) {
  const { t } = useTranslation();
  const { windows, gridMode, selectedIds, focusWindow, closeWindow, moveWindow, resizeWindow, toggleMinimize, toggleMaximize } = api;

  const handleMoveEnd = useCallback((id: number, prevPos: { x: number; y: number }) => {
    const w = windows.find((x) => x.id === id);
    if (!w) return;
    void prevPos;
  }, [windows]);

  const handleResize = useCallback((id: number, size: { width: number; height: number | null }, pos?: { x: number; y: number }) => {
    resizeWindow(id, size);
    if (pos) moveWindow(id, pos);
  }, [resizeWindow, moveWindow]);

  if (gridMode) {
    return (
      <div className="artifact-layer-grid pointer-events-none" style={{ display: "flex", flexWrap: "wrap", gap: "calc(16px * var(--mul-density))", padding: "calc(80px * var(--mul-density)) calc(20px * var(--mul-density)) calc(120px * var(--mul-density))", alignItems: "flex-start", justifyContent: "center", alignContent: "flex-start" }}>
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
              winScale={winScale}
            >
              <WindowContentRouter window={w} />
            </ArtifactWindow>
          );
        })}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 30 }} aria-label={t("canvas.aria_label")}>
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
            onMaximize={() => toggleMaximize(w.id)}
            onMove={(pos) => moveWindow(w.id, pos)}
            onMoveEnd={(prevPos) => handleMoveEnd(w.id, prevPos)}
            onResize={(size, pos) => handleResize(w.id, size, pos)}
            minW={entry?.minW}
            minH={entry?.minH}
            winScale={winScale}
          >
            <WindowContentRouter window={w} />
          </ArtifactWindow>
        );
      })}
    </div>
  );
}
