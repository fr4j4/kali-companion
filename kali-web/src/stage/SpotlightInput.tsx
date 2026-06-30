/**
 * stage/SpotlightInput.tsx — Fullscreen overlay input for text messages.
 *
 * Appears when the user starts typing (any printable keypress). Enter sends
 * the message via chat.send(), Escape closes. Uses Fraunces serif for the
 * large input text, matching the projection area typography.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Command } from "lucide-react";
import { useStage } from "./StageProvider";

interface Props {
  open: boolean;
  onClose: () => void;
  firstCharRef: React.MutableRefObject<string>;
}

export function SpotlightInput({ open, onClose, firstCharRef }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");

  // Auto-resize logic: adjust height based on scrollHeight
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    
    // Reset height to compute scrollHeight correctly
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, window.innerHeight * 0.6);
    el.style.height = `${newHeight}px`;
  }, [value, open]);

  useEffect(() => {
    if (open) {
      const first = firstCharRef.current;
      firstCharRef.current = "";
      if (first) setValue(first);
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Move cursor to end if there's initial text
          inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
        }
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setValue("");
    }
  }, [open, firstCharRef]);

  const onSubmit = useCallback(() => {
    const text = value.trim();
    if (chat.isTurnActive) return;
    if (text) {
      chat.send(text);
    }
    onClose();
  }, [chat, onClose, value]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (!e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [onSubmit, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={t("chat.placeholder") as string}
        >
          <div className="absolute inset-0 spotlight-scrim" />

          {/* Input container */}
          <motion.div
            className="relative z-10 w-full max-w-3xl px-8"
            initial={{ y: 20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div 
              className={`glass-strong rounded-3xl overflow-hidden transition-all duration-300 shadow-2xl border ${
                value.length > 0 ? "border-accent/40 ring-1 ring-accent/10" : "border-white/10"
              }`}
            >
              {/* Header / Badge */}
              <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-white/5">
                <div className="flex items-center gap-2 text-accent/80">
                  <Sparkles size={14} className="animate-pulse" />
                  <span className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-70">
                    {t("assistant.name")} Spotlight
                  </span>
                </div>
                <div className="flex items-center gap-1.5 opacity-40">
                  <Command size={12} />
                  <span className="text-[10px] font-medium uppercase tracking-wider">Interface</span>
                </div>
              </div>

              <div className="p-6 pb-4">
                <textarea
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={chat.isTurnActive ? (t("stage.waiting_response") as string) : (t("chat.placeholder") as string)}
                  onKeyDown={onKeyDown}
                  disabled={chat.isTurnActive}
                  className={`w-full bg-transparent outline-none text-center placeholder:text-muted/40 resize-none overflow-y-auto scrollbar-none transition-opacity duration-300 ${
                    chat.isTurnActive ? "opacity-50 cursor-not-allowed" : "opacity-100"
                  }`}
                  style={{
                    fontFamily: "Fraunces, serif",
                    fontSize: "calc(1.8rem * var(--mul-text))",
                    lineHeight: 1.5,
                    fontVariationSettings: '"SOFT" 60',
                    minHeight: "1.5em",
                  }}
                  aria-label={t("chat.placeholder") as string}
                />
              </div>

              {/* Footer labels */}
              <div className="flex items-center justify-center gap-6 px-6 py-3 border-t border-white/5 bg-black/10">
                <div className="flex items-center gap-1.5 text-muted/60 text-[10px] font-medium">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-fg/80 min-w-[2.5em] text-center">Enter</kbd>
                  <span>{t("chat.send")}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted/60 text-[10px] font-medium">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-fg/80 min-w-[5em] text-center">Shift+Enter</kbd>
                  <span>{t("chat.newline")}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted/60 text-[10px] font-medium">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-fg/80 min-w-[2.5em] text-center">Esc</kbd>
                  <span>{t("chat.cancel")}</span>
                </div>
                {value.length > 0 && (
                  <div className="ml-auto pl-4 border-l border-white/10 text-accent/50 font-mono text-[10px]">
                    {value.length}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
