// AttachedCapture — shows the capture the user sent from the avatar while it waits for their message.
//
// The image was already approved on the user's computer (they pressed "Send to Kali" on the
// preview). Here they can only remove it; the next message they write goes out together with it.

import { useTranslation } from "react-i18next";
import type { CaptureAttachedEvent } from "../lib/protocol";

interface Props {
  capture: CaptureAttachedEvent | null;
  onDiscard: () => void;
}

export function AttachedCapture({ capture, onDiscard }: Props) {
  const { t } = useTranslation();
  if (!capture) return null;
  return (
    <div role="status"
      className="pointer-events-auto fixed bottom-24 right-4 z-40 flex items-center gap-3 rounded-2xl border border-border bg-surface/95 p-2 pr-3 shadow-lg">
      {capture.thumb && capture.thumb.startsWith("data:image/") && (
        <img src={capture.thumb} alt="" draggable={false} className="max-h-16 max-w-[7rem] rounded-md border border-border" />
      )}
      <div className="flex flex-col text-sm">
        <span>{t("capture.attached")}</span>
        <span className="text-xs text-muted">{t("capture.attached_hint")}</span>
      </div>
      <button type="button" aria-label={t("capture.discard") as string} onClick={onDiscard}
        className="rounded-full border border-border px-2 py-1 text-sm hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent">✕</button>
    </div>
  );
}
