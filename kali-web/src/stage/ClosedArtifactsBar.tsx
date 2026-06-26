/**
 * stage/ClosedArtifactsBar.tsx — Badge + dropdown for closed windows.
 *
 * Shows a small badge in the bottom-right corner when there are closed
 * windows. Click to expand a list and restore any closed window.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ArtifactWindowData } from "../workspace/types";

interface Props {
  windows: ArtifactWindowData[];
  onRestore: (id: number) => void;
}

export function ClosedArtifactsBar({ windows, onRestore }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const closed = windows.filter((w) => w.closed);

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  if (closed.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-5 z-35">
      <button
        onClick={toggle}
        className="glass-strong rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-lg border border-white/10 text-xs text-muted hover:text-fg transition"
        aria-label={t("dock.closed.aria_label", { count: closed.length }) as string}
        title={t("dock.closed.title") as string}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span className="badge text-fg">{closed.length}</span>
      </button>
      {expanded && (
        <div className="absolute bottom-full right-0 mb-2 glass-strong rounded-xl border border-white/10 shadow-xl overflow-hidden min-w-[200px] max-w-[280px]">
          {closed.map((w) => (
            <div
              key={w.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer transition"
              onClick={() => { onRestore(w.id); setExpanded(false); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") { onRestore(w.id); setExpanded(false); } }}
              aria-label={t("dock.closed.restore", { title: w.title }) as string}
            >
              <span className="text-sm shrink-0">{w.icon}</span>
              <span className="text-xs text-fg truncate flex-1">{w.title}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted shrink-0"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}