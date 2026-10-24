/**
 * stage/v2/Detach.tsx — Taking an artifact out of the canvas, and the mark it leaves.
 *
 *   DetachButton   on the desktop «A ventana propia» (an OS window; the tab stays as a ghost),
 *                  in a browser «Abrir en pestaña nueva» (the same loose-artifact page in a tab).
 *   BringButton    on a ghost: «Traer» closes the OS window and the artifact is back in its tab.
 */

import { useTranslation } from "react-i18next";
import { AppWindow, ArrowDownLeft, ExternalLink } from "lucide-react";
import { isDesktop } from "../../lib/desktop";
import type { CanvasStateApi } from "./useCanvasState";

export function DetachButton({ canvas, id }: { canvas: Pick<CanvasStateApi, "detachWindow">; id: number }) {
  const { t } = useTranslation();
  const label = t(isDesktop() ? "v2.native.own_window" : "v2.native.new_tab") as string;
  return (
    <button type="button" className="v2-icon-btn" title={label} aria-label={label}
      onClick={(e) => { e.stopPropagation(); canvas.detachWindow(id); }}>
      {isDesktop() ? <AppWindow size={16} aria-hidden="true" /> : <ExternalLink size={16} aria-hidden="true" />}
    </button>
  );
}

export function BringButton({ canvas, id, title, compact }: { canvas: Pick<CanvasStateApi, "bring">; id: number; title: string; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="v2-bring" title={t("v2.native.bring_title", { title }) as string}
      onClick={(e) => { e.stopPropagation(); canvas.bring(id); }} onPointerDown={(e) => e.stopPropagation()}>
      <ArrowDownLeft size={12} aria-hidden="true" />{!compact && <span>{t("v2.native.bring")}</span>}
    </button>
  );
}
