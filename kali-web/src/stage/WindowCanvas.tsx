import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceAPI } from "../workspace/types";
import { KaliWindow } from "./Window";
import { WindowContentRouter } from "./WindowContentRouter";
import { widgetRegistry } from "../components/widgets/widgetRegistry";
import type { Position, Size } from "../workspace/types";
import type { GameContent } from "../components/widgets/GameWidget";

interface Props {
  api: WorkspaceAPI;
  winScale?: number;
}

export function WindowCanvas({ api, winScale = 1 }: Props) {
  const { t } = useTranslation();
  const { windows, gridMode, selectedIds, focusWindow, closeWindow, moveWindow, resizeWindow, toggleMinimize, toggleMaximize, persistWindow } = api;

  const handleMoveEnd = useCallback((id: number, _prevPos: Position) => {
    persistWindow(id);
  }, [persistWindow]);

  const handleResize = useCallback((id: number, size: Size, pos?: Position) => {
    resizeWindow(id, size);
    if (pos) moveWindow(id, pos);
  }, [resizeWindow, moveWindow]);

  const getGameBodyAspectRatio = (w: WorkspaceAPI["windows"][number]) => {
    if (w.type !== "game") return undefined;
    const content = (w.content ?? {}) as GameContent;
    if (content.mode === "game" && content.gameType) {
      return widgetRegistry.game?.aspectRatio;
    }
    return undefined;
  };

  if (gridMode) {
    return (
      <div className="artifact-layer-grid pointer-events-none" style={{ display: "flex", flexWrap: "wrap", gap: "calc(16px * var(--mul-density))", padding: "calc(80px * var(--mul-density)) calc(20px * var(--mul-density)) calc(120px * var(--mul-density))", alignItems: "flex-start", justifyContent: "center", alignContent: "flex-start" }}>
        {windows.filter((w) => !w.closed).map((w) => {
          const entry = widgetRegistry[w.type];
          const bodyAspectRatio = w.type === "game" ? getGameBodyAspectRatio(w) : entry?.aspectRatio;
          return (
            <KaliWindow
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
              bodyAspectRatio={bodyAspectRatio}
            >
              <WindowContentRouter window={w} api={api} />
            </KaliWindow>
          );
        })}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 30 }} aria-label={t("canvas.aria_label")}>
      {windows.filter((w) => !w.closed).map((w) => {
        const entry = widgetRegistry[w.type];
        const bodyAspectRatio = w.type === "game" ? getGameBodyAspectRatio(w) : entry?.aspectRatio;
          return (
            <KaliWindow
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
              bodyAspectRatio={bodyAspectRatio}
            >
              <WindowContentRouter window={w} api={api} />
            </KaliWindow>
          );
      })}
    </div>
  );
}
