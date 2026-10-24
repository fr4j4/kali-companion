/**
 * stage/ActivityPanel.tsx — Small glass card (bottom-left) listing what Kali is doing right now.
 *
 * Shows the latest status of each recent tool call while one is running and for a few seconds
 * afterwards, then fades out. Desktop only; it never takes focus.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, X } from "lucide-react";
import type { ToolEvent } from "../lib/protocol";
import { useStage } from "./StageProvider";

const LINGER_MS = 6000;
const MAX_ROWS = 5;

/** Latest event per tool, most recent last. */
export function latestPerTool(events: ToolEvent[]): ToolEvent[] {
  const byTool = new Map<string, ToolEvent>();
  for (const ev of events) {
    byTool.delete(ev.tool);
    byTool.set(ev.tool, ev);
  }
  return [...byTool.values()];
}

export function ActivityPanel() {
  const { t } = useTranslation();
  const { chat } = useStage();
  const rows = useMemo(() => latestPerTool(chat.toolEvents).slice(-MAX_ROWS), [chat.toolEvents]);
  const running = rows.some((r) => r.status === "running");
  const [lingering, setLingering] = useState(false);

  useEffect(() => {
    if (rows.length === 0) return;
    setLingering(true);
    const id = setTimeout(() => setLingering(false), LINGER_MS);
    return () => clearTimeout(id);
  }, [chat.toolEvents]);

  if (rows.length === 0 || !(running || lingering)) return null;

  return (
    <div
      className="activity-panel absolute left-7 top-20 z-30 w-56 rounded-2xl border border-border bg-elevated/80 px-3 py-2.5 pointer-events-none"
      style={{ backdropFilter: "blur(var(--fx-blur-panel, 12px))" }}
      role="status"
      aria-label={t("activity.label") as string}
    >
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{t("activity.label")}</div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => (
          <li key={r.tool} className="flex items-center gap-2 text-xs text-fg">
            {r.status === "running" ? (
              <Loader2 size={13} className="shrink-0 animate-spin text-accent" aria-hidden />
            ) : r.status === "success" ? (
              <Check size={13} className="shrink-0 text-ok" aria-hidden />
            ) : (
              <X size={13} className="shrink-0 text-err" aria-hidden />
            )}
            <span className="truncate font-mono">{r.tool}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
