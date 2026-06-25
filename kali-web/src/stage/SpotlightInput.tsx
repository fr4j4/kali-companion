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
import { useStage } from "./StageProvider";

interface Props {
  open: boolean;
  onClose: () => void;
  firstCharRef: React.MutableRefObject<string>;
}

export function SpotlightInput({ open, onClose, firstCharRef }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) {
      const first = firstCharRef.current;
      firstCharRef.current = "";
      if (first) setValue(first);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
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
      e.preventDefault();
      onSubmit();
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
          {/* Backdrop: solid scrim is far cheaper than backdrop-blur in
              WebKitGTK without GPU compositing. The blur is opt-in via the
              `.glass` utility (see styles.css) gated on `@supports`. */}
          <div className="absolute inset-0 spotlight-scrim" />

          {/* Input container */}
          <motion.div
            className="relative z-10 w-full max-w-3xl px-8"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("chat.placeholder") as string || "Escribe algo..."}
              onKeyDown={onKeyDown}
              className="w-full bg-transparent outline-none text-center text-fg placeholder:text-muted/40"
              style={{
                fontFamily: "Fraunces, serif",
                fontSize: "calc(2rem * var(--mul-text))",
                lineHeight: 1.4,
                fontVariationSettings: '"SOFT" 60',
              }}
              aria-label={t("chat.placeholder") as string}
            />
            <div className="text-center text-xs text-muted/50 mt-3">
              {chat.isThinking ? (
                <span>{t("stage.thinking")} · <kbd className="kbd">Esc</kbd> {t("chat.cancel")}</span>
              ) : (
                <><kbd className="kbd">Enter</kbd> {t("chat.send")} · <kbd className="kbd">Esc</kbd> {t("chat.cancel")}</>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}