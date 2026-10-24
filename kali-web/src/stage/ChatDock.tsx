/**
 * stage/ChatDock.tsx — Docked, resizable conversation panel (wide screens).
 *
 * Keeps the conversation and its composer always in reach instead of behind a modal or the
 * "start typing" spotlight. The stage (avatar, windows, dock) lays out in the space left of it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, PanelRightClose, Square } from "lucide-react";
import { useStage } from "./StageProvider";
import { ConversationLog } from "./ConversationLog";
import { CHAT_DOCK_MAX, CHAT_DOCK_MIN } from "./useChatDock";

interface Props {
  width: number;
  onWidthChange: (w: number, persist?: boolean) => void;
  onClose: () => void;
  /** Reports typing state so the avatar can react the same way it does with the spotlight. */
  onTypingChange: (typing: boolean) => void;
}

export function ChatDock({ width, onWidthChange, onClose, onTypingChange }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const busy = chat.isTurnActive;

  // Autosize up to ~8 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  // The stage forwards "start typing anywhere" here instead of opening the spotlight.
  useEffect(() => {
    const focus = () => taRef.current?.focus();
    window.addEventListener("kali:chat-focus", focus);
    return () => window.removeEventListener("kali:chat-focus", focus);
  }, []);

  useEffect(() => () => onTypingChange(false), [onTypingChange]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || busy) return;
    chat.send(text);
    setValue("");
  }, [value, busy, chat]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => onWidthChange(startW + (startX - ev.clientX), false);
    const up = (ev: PointerEvent) => {
      onWidthChange(startW + (startX - ev.clientX), true);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const onSeparatorKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); onWidthChange(width + 24); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onWidthChange(width - 24); }
  };

  return (
    <aside
      className="chat-dock absolute inset-y-0 right-0 z-[45] flex flex-col"
      style={{ width }}
      aria-label={t("conversation.title") as string}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chat.resize") as string}
        aria-valuemin={CHAT_DOCK_MIN}
        aria-valuemax={CHAT_DOCK_MAX}
        aria-valuenow={width}
        tabIndex={0}
        className="chat-dock-grip"
        onPointerDown={startResize}
        onKeyDown={onSeparatorKey}
      />
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-fg">{t("conversation.title")}</h2>
        <button type="button" className="kw-ctl" onClick={onClose} aria-label={t("chat.collapse") as string} title={t("chat.collapse") as string}>
          <PanelRightClose size={16} aria-hidden="true" />
        </button>
      </header>
      <ConversationLog />
      <div className="shrink-0 border-t border-border p-3">
        <div className="chat-composer flex items-end gap-2 rounded-2xl border border-border bg-surface/60 py-2 pl-3.5 pr-2">
          <textarea
            ref={taRef}
            value={value}
            rows={1}
            onChange={(e) => { setValue(e.target.value); onTypingChange(e.target.value.length > 0); }}
            onKeyDown={onKeyDown}
            onBlur={() => onTypingChange(false)}
            placeholder={busy ? (t("stage.waiting_response") as string) : (t("chat.placeholder") as string)}
            aria-label={t("chat.placeholder") as string}
            className="max-h-[180px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-sm leading-snug text-fg outline-none placeholder:text-muted"
          />
          {busy ? (
            <button type="button" onClick={chat.stop} className="chat-send bg-err text-white" aria-label={t("chat.stop") as string} title={t("chat.stop") as string}>
              <Square size={13} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!value.trim()} className="chat-send bg-accent text-on-accent" aria-label={t("chat.send") as string} title={t("chat.send") as string}>
              <ArrowUp size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-muted">{t("chat.composer_hint")}</p>
      </div>
    </aside>
  );
}
