import { AnimatePresence, motion } from "framer-motion";
import { Mic } from "lucide-react";
import { useStage } from "./StageProvider";

export function TranscriptionBar() {
  const { chat, ptt } = useStage();

  const showPartial = ptt.state === "recording" && ptt.partialText.length > 0;
  const showFinal = ptt.finalText.length > 0 && ptt.state !== "recording";

  const text = showPartial ? ptt.partialText : showFinal ? ptt.finalText : "";
  const provider = chat.systemStatus?.stt_provider ?? "vosk";

  return (
    <AnimatePresence>
      {(showPartial || showFinal) && (
        <motion.div
          className="fixed bottom-28 left-1/2 -translate-x-1/2 z-40 max-w-lg w-[90vw]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="glass-strong rounded-2xl px-4 py-2.5 flex items-center gap-3 shadow-2xl border border-fg/10">
            <Mic size={14} className="text-accent shrink-0" />
            <span className="text-xs text-foreground/80 leading-relaxed line-clamp-2 break-words flex-1">
              {text}
            </span>
            <span className="text-[10px] font-mono text-muted/50 bg-fg/5 rounded px-1.5 py-0.5 shrink-0">
              {provider}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
