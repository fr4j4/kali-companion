// AttachedCapture — shows the capture the user sent from the avatar while it waits for their message.
//
// The image was already approved on the user's computer (they pressed "Send to Kali" on the
// preview). Here they can only remove it; the next message they write goes out together with it.

import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { CaptureAttachedEvent } from "../lib/protocol";

interface Props {
  capture: CaptureAttachedEvent | null;
  onDiscard: () => void;
}

export function AttachedCapture({ capture, onDiscard }: Props) {
  const { t } = useTranslation();
  if (!capture) return null;
  return (
    <div role="status" className="kw-capture">
      {capture.thumb && capture.thumb.startsWith("data:image/") && (
        <img src={capture.thumb} alt="" draggable={false} />
      )}
      <div className="flex min-w-0 flex-col">
        <span className="kw-capture-title">{t("capture.attached")}</span>
        <span className="kw-capture-hint">{t("capture.attached_hint")}</span>
      </div>
      <button type="button" className="v2-icon-btn sm" aria-label={t("capture.discard") as string} title={t("capture.discard") as string} onClick={onDiscard}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
