/**
 * stage/MinimizeDock.tsx — Lateral dock for minimized windows.
 *
 * Shows minimized (but not closed) windows as small bars. Click to restore.
 * Hidden on mobile (CSS handles that via #minimize-dock display:none).
 */

import { useTranslation } from "react-i18next";
import type { ArtifactWindowData } from "../workspace/types";

interface Props {
  windows: ArtifactWindowData[];
  onRestore: (id: number) => void;
}

export function MinimizeDock({ windows, onRestore }: Props) {
  const { t } = useTranslation();
  const minimized = windows.filter((w) => w.minimized && !w.closed);
  if (minimized.length === 0) return null;

  return (
    <div id="minimize-dock">
      {minimized.map((w) => (
        <div
          key={w.id}
          className="min-bar"
          onClick={() => onRestore(w.id)}
          role="button"
          tabIndex={0}
          aria-label={t("dock.minimize.restore", { title: w.title }) as string}
          onKeyDown={(e) => { if (e.key === "Enter") onRestore(w.id); }}
        >
          <span>{w.icon}</span>
          <span className="truncate">{w.title}</span>
        </div>
      ))}
    </div>
  );
}