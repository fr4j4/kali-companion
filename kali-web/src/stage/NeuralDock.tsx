/**
 * stage/NeuralDock.tsx — Bottom control bar (reworked).
 *
 * 3 groups with visual weight:
 *   [ MIC (big, labeled) ] │ [grid focus orbit pulse] │ [⋯ overflow]
 *
 * Overflow opens a mini-menu with Audio, Undo, Clear, Debug.
 * Panel buttons (customizer/library/conversation) moved to HUD top-left.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bug, MoreHorizontal, Volume2, Undo2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStage } from "./StageProvider";
import type { WorkspaceAPI } from "../workspace/types";

interface Props {
  api: WorkspaceAPI;
  onToggleDebug?: () => void;
}

export function NeuralDock({ api, onToggleDebug }: Props) {
  const { t } = useTranslation();
  const { chat, ptt } = useStage();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  const onStop = useCallback(() => chat.stop(), [chat]);

  const isStreaming = chat.messages.some((m) => m.streaming);
  const isPttActive = ptt.state !== "idle";
  const isChatActive = isStreaming || chat.isThinking;
  const isActive = isPttActive || isChatActive;

  const handleMicClick = () => {
    if (isPttActive) {
      ptt.stop();
    } else if (isChatActive) {
      onStop();
    } else {
      ptt.start();
    }
  };

  useEffect(() => {
    if (!overflowOpen) return;
    function onDown(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [overflowOpen]);

  return (
    <footer className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40">
      <div className="glass-strong rounded-2xl px-3 py-2.5 flex items-center gap-2 shadow-2xl border border-white/10">
        {/* ── Primary: Mic / Stop ─────────────────────────── */}
        <button
          onClick={handleMicClick}
          className={`flex items-center gap-2 h-9 px-4 rounded-xl transition badge ${
            isActive
              ? "bg-red-500/15 text-red-300 hover:brightness-110"
              : "bg-accent/10 text-accent hover:bg-accent/20"
          }`}
          aria-label={isActive ? t("dock.mic_stop") : t("dock.mic_label")}
          title={isActive ? t("dock.mic_stop") : t("dock.mic_label")}
        >
          {isActive ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
          <span className="text-xs font-medium">{isActive ? t("dock.mic_stop") : t("dock.mic_label")}</span>
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* ── Workspace ops ───────────────────────────────── */}
        <button
          onClick={api.toggleGrid}
          className="tooltip h-9 w-9 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center justify-center badge"
          title={t("dock.grid")}
          aria-label={t("dock.grid")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>

        <button
          onClick={api.focusLast}
          className="tooltip h-9 w-9 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center justify-center badge"
          title={t("dock.focus")}
          aria-label={t("dock.focus")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="7" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
          </svg>
        </button>

        <button
          onClick={api.arrangeOrbit}
          className="tooltip h-9 w-9 rounded-xl hover:bg-accent2/20 text-muted hover:text-accent2 transition flex items-center justify-center badge"
          title={t("dock.orbit")}
          aria-label={t("dock.orbit")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="9" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>

        <button
          onClick={api.networkPulse}
          className="tooltip h-9 w-9 rounded-xl hover:bg-accent/20 text-muted hover:text-accent transition flex items-center justify-center badge"
          title={t("dock.pulse")}
          aria-label={t("dock.pulse")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* ── Overflow menu ───────────────────────────────── */}
        <div className="relative" ref={overflowRef}>
          <button
            onClick={() => setOverflowOpen((v) => !v)}
            className={`h-9 w-9 rounded-xl transition flex items-center justify-center badge ${
              overflowOpen
                ? "bg-white/10 text-fg"
                : "hover:bg-white/8 text-muted hover:text-fg"
            }`}
            title={t("dock.overflow")}
            aria-label={t("dock.overflow")}
            aria-expanded={overflowOpen}
          >
            <MoreHorizontal size={16} />
          </button>

          {overflowOpen && (
            <div className="ctx-menu absolute bottom-12 right-0 min-w-[160px]">
              <button
                className="ctx-item w-full"
                onClick={() => {
                  api.toggleAudio();
                  setOverflowOpen(false);
                }}
              >
                <Volume2 size={14} />
                {t("dock.audio")}
              </button>
              <button
                className="ctx-item w-full"
                onClick={() => {
                  api.undo();
                  setOverflowOpen(false);
                }}
              >
                <Undo2 size={14} />
                {t("dock.undo")}
              </button>
              {import.meta.env.DEV && (
                <>
                  <div className="ctx-sep" />
                  <button
                    className="ctx-item w-full"
                    onClick={() => {
                      onToggleDebug?.();
                      setOverflowOpen(false);
                    }}
                  >
                    <Bug size={14} />
                    {t("dock.debug")}
                  </button>
                </>
              )}
              <div className="ctx-sep" />
              <button
                className="ctx-item danger w-full"
                onClick={() => {
                  api.clearAll();
                  setOverflowOpen(false);
                }}
              >
                <Trash2 size={14} />
                {t("dock.clear")}
              </button>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}