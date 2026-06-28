/**
 * stage/VoiceBar.tsx — Floating TTS playback indicator.
 *
 * Appears above the dock when TTS is playing. Shows an audio visualizer,
 * "Kali is speaking" text, and a mute button. Disappears when TTS stops.
 */

import { AnimatePresence, motion } from "framer-motion";
import { VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStage } from "./StageProvider";
import { AudioVisualizer } from "../components/AudioVisualizer";

export function VoiceBar() {
  const { t } = useTranslation();
  const { tts } = useStage();

  return (
    <AnimatePresence>
      {tts.playing && (
        <motion.div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="glass-strong rounded-2xl px-4 py-2.5 flex items-center gap-3 shadow-2xl border border-white/10">
            <AudioVisualizer analyser={tts.analyser} active={tts.playing} />
            <span className="text-xs text-muted badge">
              {t("stage.speaking") as string}
              {tts.totalSegments > 0 && (
                <span className="ml-1.5 text-muted/50">{tts.currentSegment}/{tts.totalSegments}</span>
              )}
            </span>
            <button
              onClick={tts.stop}
              className="w-8 h-8 rounded-lg hover:bg-white/10 text-muted hover:text-fg transition flex items-center justify-center shrink-0"
              aria-label={t("chat.mute_tts") as string}
              title={t("chat.mute_tts") as string}
            >
              <VolumeX size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}