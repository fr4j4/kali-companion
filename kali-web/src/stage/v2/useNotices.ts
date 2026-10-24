/**
 * stage/v2/useNotices.ts — Errors and short notices, collected for the notices pill.
 *
 * Replaces the error toasts: each new error flashes inside the pill for a few seconds, then stays
 * in its list until cleared. A stopped turn is a quiet notice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStage } from "../StageProvider";

export interface Notice { id: number; kind: "error" | "info"; text: string; at: number }

export const FLASH_MS = 4500;
const MAX_NOTICES = 20;

export function useNotices() {
  const { t } = useTranslation();
  const { chat, ptt } = useStage();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [flash, setFlash] = useState<Notice | null>(null);
  const seq = useRef(0);

  const push = useCallback((kind: Notice["kind"], text: string) => {
    const n: Notice = { id: ++seq.current, kind, text, at: Date.now() };
    setNotices((list) => [...list, n].slice(-MAX_NOTICES));
    setFlash(n);
  }, []);

  useEffect(() => { if (chat.error) push("error", chat.error); }, [chat.error, push]);
  useEffect(() => { if (ptt.error) push("error", ptt.error); }, [ptt.error, push]);
  useEffect(() => { if (chat.stopped) push("info", t("stage.stopped")); }, [chat.stopped, push, t]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const clear = useCallback(() => { setNotices([]); setFlash(null); }, []);
  const dismiss = useCallback((id: number) => {
    setNotices((list) => list.filter((n) => n.id !== id));
    setFlash((f) => (f?.id === id ? null : f));
  }, []);

  return { notices, flash, clear, dismiss };
}
