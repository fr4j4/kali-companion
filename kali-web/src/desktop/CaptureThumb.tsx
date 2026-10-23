import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { playShutter } from "../lib/shutter";

export interface CaptureFeedbackOptions {
  thumbnail: boolean;
  sound: boolean;
}

/** How long the thumbnail stays next to the avatar. */
export const THUMB_MS = 4000;

/**
 * Feedback for a capture that already happened: a small thumbnail and a shutter click. It never
 * asks or grants anything; consent is given before the capture, on the agent's card.
 */
export function useCaptureFeedback(options: CaptureFeedbackOptions) {
  const [thumb, setThumb] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const captured = useCallback((image: string | null, override?: Partial<CaptureFeedbackOptions>) => {
    const { thumbnail, sound } = { ...latest.current, ...override };
    if (sound) playShutter();
    window.clearTimeout(timer.current);
    if (!thumbnail || !image || !image.startsWith("data:image/")) { setThumb(null); return; }
    setThumb(image);
    timer.current = window.setTimeout(() => setThumb(null), THUMB_MS);
  }, []);
  return { thumb, captured };
}

/** Thumbnail overlay: never takes pointer events or focus, and appears and disappears without animation. */
export function CaptureThumb({ thumb }: { thumb: string | null }) {
  const { t } = useTranslation();
  if (!thumb) return null;
  return <img src={thumb} alt={t("desktop.capture_taken") as string} role="img" draggable={false}
    className="pointer-events-none absolute right-1 top-1 max-h-[38%] max-w-[45%] rounded-md border border-border shadow-lg" />;
}
