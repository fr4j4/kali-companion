/**
 * stage/NeuralDock.tsx — Bottom control bar for the Neural Canvas.
 *
 * Buttons: Grid/Foco/Orbitar/Pulso/Avatar/Biblioteca/Audio/Undo/Limpiar
 * Also includes the mic button (ptt) with recording/processing states.
 *
 * Text input is handled by SpotlightInput (fullscreen overlay) instead
 * of an inline input field. NeuralDock only needs the typing state to
 * know when the spotlight is open.
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useStage } from "./StageProvider";
import type { WorkspaceAPI } from "../workspace/types";

interface Props {
  onToggleDrawer?: () => void;
  onToggleCustomizer?: () => void;
  onToggleConversation?: () => void;
  api: WorkspaceAPI;
}

export function NeuralDock({ onToggleDrawer, onToggleCustomizer, onToggleConversation, api }: Props) {
  const { t } = useTranslation();
  const { chat, ptt } = useStage();

  const onMic = useCallback(() => {
    if (ptt.state === "recording") ptt.stop();
    else ptt.start();
  }, [ptt]);

  const onStop = useCallback(() => chat.stop(), [chat]);

  const isStreaming = chat.messages.some((m) => m.streaming);
  const isRecording = ptt.state === "recording";

  // While recording, the mic button acts as a stop; the live transcript
  // is shown by the floating MicIndicator above the dock.
  return (
    <footer className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40">
      <div className="glass-strong rounded-2xl px-3 py-2.5 flex items-center gap-2 shadow-2xl border border-white/10">
        {/* Mic / Stop button — toggles recording, or stops streaming */}
        <button
          onClick={isStreaming ? onStop : onMic}
          className={`tooltip h-9 px-3 rounded-xl transition flex items-center gap-2 badge ${
            isStreaming || isRecording
              ? "bg-red-500/15 text-red-300 hover:brightness-110"
              : "hover:bg-white/8 text-muted hover:text-fg"
          }`}
          aria-label={isStreaming || isRecording ? t("dock.stop") as string : t("dock.mic") as string}
          title={isStreaming || isRecording ? t("dock.stop") as string : t("dock.mic") as string}
        >
          {isStreaming || isRecording ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          )}
        </button>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Workspace controls (from api) */}
        <button onClick={api.toggleGrid} className="tooltip h-9 px-3 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center gap-2 badge" title={t("dock.grid") as string} aria-label={t("dock.grid") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>

        <button onClick={api.focusLast} className="tooltip h-9 px-3 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center gap-2 badge" title={t("dock.focus") as string} aria-label={t("dock.focus") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>
        </button>

        <button onClick={api.arrangeOrbit} className="tooltip h-9 px-3 rounded-xl hover:bg-accent2/20 text-muted hover:text-accent2 transition flex items-center gap-2 badge" title={t("dock.orbit") as string} aria-label={t("dock.orbit") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>
        </button>

        <button onClick={api.networkPulse} className="tooltip h-9 px-3 rounded-xl hover:bg-accent/20 text-muted hover:text-accent transition flex items-center gap-2 badge" title={t("dock.pulse") as string} aria-label={t("dock.pulse") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </button>

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Customizer button */}
        <button onClick={onToggleCustomizer} className="tooltip h-9 px-3 rounded-xl hover:bg-accent3/20 text-muted hover:text-accent3 transition flex items-center gap-2 badge" title={t("dock.customizer") as string} aria-label={t("dock.customizer") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>

        {/* Drawer button (session history) */}
        <button onClick={onToggleDrawer} className="tooltip h-9 px-3 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center gap-2 badge" title={t("dock.library") as string} aria-label={t("dock.library") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
        </button>

        {/* Conversation button */}
        {onToggleConversation && (
          <button onClick={onToggleConversation} className="tooltip h-9 px-3 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center gap-2 badge" title={t("dock.conversation") as string} aria-label={t("dock.conversation") as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
        )}

        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Audio toggle */}
        <button onClick={api.toggleAudio} className="tooltip h-9 px-3 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center gap-2 badge" title={t("dock.audio") as string} aria-label={t("dock.audio") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
        </button>

        {/* Undo */}
        <button onClick={api.undo} className="tooltip h-9 px-3 rounded-xl hover:bg-white/8 text-muted hover:text-fg transition flex items-center gap-2 badge" title={t("dock.undo") as string} aria-label={t("dock.undo") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 13"/></svg>
        </button>

        {/* Clear */}
        <button onClick={api.clearAll} className="tooltip h-9 px-3 rounded-xl hover:bg-red-500/15 text-red-300/80 hover:text-red-300 transition flex items-center gap-2 badge" title={t("dock.clear") as string} aria-label={t("dock.clear") as string}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </footer>
  );
}