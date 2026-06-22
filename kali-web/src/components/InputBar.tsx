// InputBar — text input + send button + PTT button.
//
// Enter sends, Shift+Enter inserts a newline. Disabled while the assistant
// is streaming (use the stop button instead). Includes a mic button for
// push-to-talk voice input (WhatsApp-style).

import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { PTTButton } from "./PTTButton";
import type { PTTState } from "../hooks/usePTT";

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  // PTT
  pttState: PTTState;
  pttPartialText: string;
  onPTTStart: () => void;
  onPTTStop: () => void;
  onPTTCancel: () => void;
}

export function InputBar({
  onSend,
  onStop,
  streaming,
  pttState,
  pttPartialText,
  onPTTStart,
  onPTTStop,
  onPTTCancel,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // PTT final transcript is auto-sent by App.tsx directly (not populated into the input).

  return (
    <div className="flex gap-2 items-end pb-[env(safe-area-inset-bottom)]">
      <textarea
        className="flex-1 bg-surface text-foreground border border-border rounded-[10px] px-3 py-2.5 font-inherit text-sm resize-none max-h-[120px] outline-none min-h-[44px] focus:border-accent-dim disabled:opacity-60"
        placeholder={t("chat.placeholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        disabled={streaming || pttState === "recording"}
      />
      {streaming ? (
        <button className="border-none rounded-[10px] px-3.5 py-2.5 text-base cursor-pointer bg-err text-white hover:brightness-110 max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center" onClick={onStop} aria-label="Stop">
          ⏹
        </button>
      ) : (
        <>
          <PTTButton
            state={pttState}
            partialText={pttPartialText}
            onStart={onPTTStart}
            onStop={onPTTStop}
            onCancel={onPTTCancel}
            disabled={pttState === "processing"}
          />
          {text.trim() && (
            <button className="border-none rounded-[10px] px-3.5 py-2.5 text-base cursor-pointer bg-accent text-white hover:brightness-110 max-lg:min-w-[44px] max-lg:min-h-[44px] flex items-center justify-center" onClick={submit} aria-label={t("chat.send")}>
              ➤
            </button>
          )}
        </>
      )}
    </div>
  );
}