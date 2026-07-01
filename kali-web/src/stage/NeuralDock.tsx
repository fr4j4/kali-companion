/**
 * stage/NeuralDock.tsx — Bottom control bar (reworked).
 *
 * 3 groups with visual weight:
 *   [ MIC (big, labeled) ] │ [grid focus orbit pulse] │ [⋯ overflow]
 *
 * Overflow opens a mini-menu with Audio, Undo, Clear, Debug.
 * Panel buttons (customizer/library/conversation) moved to HUD top-left.
 */

import { useEffect, useRef, useState } from "react";
import { Bug, Gamepad2, Mic, MoreHorizontal, Send, Square, Trash2, Undo2, Volume2, X } from "lucide-react";
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

  const isStreaming = chat.messages.some((m) => m.streaming);
  const isRecording = ptt.state === "recording";
  const isSpeaking = ptt.isSpeaking;
  const isChatActive = isStreaming || chat.isThinking;
  const isControlVisible = isRecording || isChatActive;
  const sttEnabled = chat.systemStatus?.stt_enabled ?? true;

  const handleRecordClick = () => {
    if (isRecording) {
      ptt.stop();
    } else {
      ptt.start();
    }
  };

  const handleControlClick = () => {
    if (isRecording) {
      ptt.cancel();
    } else if (isChatActive) {
      chat.stop();
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
        {/* ── Workspace ops ───────────────────────────────── */}
        <button
          onClick={api.toggleGrid}
          disabled={isChatActive || isRecording}
          className={`h-9 w-9 rounded-xl transition flex items-center justify-center badge ${
            isChatActive || isRecording
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-white/8 text-muted hover:text-fg"
          }`}
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
          disabled={isChatActive || isRecording}
          className={`h-9 w-9 rounded-xl transition flex items-center justify-center badge ${
            isChatActive || isRecording
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-white/8 text-muted hover:text-fg"
          }`}
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
          disabled={isChatActive || isRecording}
          className={`h-9 w-9 rounded-xl transition flex items-center justify-center badge ${
            isChatActive || isRecording
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-accent/20 text-muted hover:text-accent"
          }`}
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
          disabled={isChatActive || isRecording}
          className={`h-9 w-9 rounded-xl transition flex items-center justify-center badge ${
            isChatActive || isRecording
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-accent/20 text-muted hover:text-accent"
          }`}
          title={t("dock.pulse")}
          aria-label={t("dock.pulse")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* ── Central record button ─────────────────────────── */}
        <button
          onClick={sttEnabled ? handleRecordClick : undefined}
          disabled={!sttEnabled}
          className={`flex items-center justify-center h-14 w-14 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${
            !sttEnabled
              ? "bg-white/10 text-muted cursor-not-allowed opacity-40"
              : isRecording
                ? isSpeaking
                  ? "bg-red-500 text-white shadow-red-500/25 animate-rec-pulse"
                  : "bg-red-500 text-white hover:bg-red-600 shadow-red-500/25"
                : "bg-accent text-white hover:bg-accent/90 shadow-accent/25"
          }`}
          aria-label={sttEnabled ? (isRecording ? t("dock.mic_stop") : t("dock.mic_label")) : t("dock.mic_disabled")}
          title={sttEnabled ? (isRecording ? t("dock.mic_stop") : t("dock.mic_label")) : t("dock.mic_disabled")}
        >
          {isRecording ? (isSpeaking ? <div className="w-5 h-5 rounded-full bg-current" /> : <Send size={24} />) : <Mic size={24} />}
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* ── Control button (right side): cancel recording or stop AI ───────────────── */}
        <button
          onClick={handleControlClick}
          disabled={!isControlVisible}
          className={`h-9 w-9 rounded-xl transition flex items-center justify-center badge ${
            isControlVisible
              ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
              : "opacity-30 cursor-not-allowed text-muted"
          }`}
          aria-label={isRecording ? t("dock.mic_cancel") : t("dock.mic_stop")}
          title={isRecording ? t("dock.mic_cancel") : t("dock.mic_stop")}
        >
          {isRecording ? <X size={16} /> : <Square size={16} />}
        </button>

        {/* ── Toys button ──────────────────────────────────── */}
        <button
          onClick={() => {
            const existing = api.windows.find(
              (w) => w.type === "game" && (w.content as any)?.mode === "launchpad",
            );
            if (existing && !existing.closed) {
              api.focusWindow(existing.id);
            } else {
              api.createWindow("game", {
                title: t("dock.toys"),
                icon: "\u{1F3AE}",
                content: { mode: "launchpad" },
                resizable: true,
                minW: 360,
                minH: 400,
              });
            }
          }}
          disabled={isChatActive || isRecording}
          className={`h-9 w-9 rounded-xl transition flex items-center justify-center badge ${
            isChatActive || isRecording
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-accent/20 text-muted hover:text-accent"
          }`}
          title={t("dock.toys")}
          aria-label={t("dock.toys")}
        >
          <Gamepad2 size={16} />
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