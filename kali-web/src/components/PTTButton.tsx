// PTTButton — WhatsApp-style mic button with record/stop/cancel.
//
// Click the mic to start recording. While recording, a stop button
// appears (sends the audio) and a cancel button (X) discards it.
// Shows the live partial transcription during recording.

import { useTranslation } from "react-i18next";
import type { PTTState } from "../hooks/usePTT";

interface Props {
  state: PTTState;
  partialText: string;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function PTTButton({
  state,
  partialText,
  onStart,
  onStop,
  onCancel,
  disabled,
}: Props) {
  const { t } = useTranslation();

  if (state === "recording") {
    return (
      <div className="flex gap-2 items-center flex-1">
        <div className="flex-1 bg-surface border border-accent-dim rounded-[10px] px-3 py-2.5 text-sm text-muted min-h-[44px] italic">{partialText || "…"}</div>
        <button
          className="border-none rounded-[10px] px-3.5 py-2.5 text-base cursor-pointer bg-err text-white hover:brightness-110 max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center"
          onClick={onCancel}
          aria-label={t("chat.cancel")}
          title={t("chat.cancel")}
        >
          ✕
        </button>
        <button
          className="border-none rounded-[10px] px-3.5 py-2.5 text-base cursor-pointer bg-accent text-white hover:brightness-110 max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center"
          onClick={onStop}
          aria-label={t("chat.send")}
          title={t("chat.send")}
        >
          ➤
        </button>
      </div>
    );
  }

  if (state === "processing") {
    return (
      <button className="border-none rounded-[10px] px-3.5 py-2.5 text-base cursor-pointer bg-accent text-white hover:brightness-110 max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center opacity-60 cursor-not-allowed" disabled>
        ⏳
      </button>
    );
  }

  return (
    <button
      className="border border-border rounded-[10px] px-3.5 py-2.5 text-base cursor-pointer bg-surface text-foreground hover:bg-accent-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center"
      onClick={onStart}
      disabled={disabled}
      aria-label={t("voice.ptt.hint")}
      title={t("voice.ptt.hint")}
    >
      🎤
    </button>
  );
}