/**
 * stage/ConversationModal.tsx — Full conversation history modal.
 *
 * Shows all messages from the current session: user messages in italic
 * serif muted, assistant messages in serif normal. Opened via a button
 * in the HUD.
 */

import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStage } from "./StageProvider";
import type { ChatMessage } from "../hooks/useChat";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ConversationModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when opened or new message arrives.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, chat.messages]);

  if (!open) return null;

  const messages = chat.messages.filter((m) => m.content || m.toolEvent);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("conversation.title") as string || "Conversation"}
    >
      <div
        className="bg-elevated border border-border rounded-xl shadow-lg w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground m-0">
            {t("conversation.title") || "Conversation"}
          </h2>
          <button
            className="bg-transparent border-none text-muted text-base cursor-pointer"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-3">
          {messages.length === 0 && (
            <p className="text-muted text-sm text-center py-8">
              {t("conversation.empty") || "No messages yet"}
            </p>
          )}
          {messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageRow({ msg }: { msg: ChatMessage }) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";

  if (msg.toolEvent && !msg.content) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted py-1 px-2">
        <span className="badge px-1.5 py-0.5 rounded bg-accent/10 text-accent">
          {msg.toolEvent.tool}
        </span>
        <span className="text-muted/60">
          {t(`tool.${msg.toolEvent.status}`) || msg.toolEvent.status}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}>
      <span className="text-[10px] text-muted/40 badge px-1">
        {isUser ? t("conversation.you") || "You" : "Kali"}
      </span>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-user-bubble text-fg rounded-br-md italic"
            : "bg-assistant-bubble border border-border text-fg rounded-bl-md"
        }`}
        style={!isUser ? { fontFamily: "Fraunces, serif", fontVariationSettings: '"SOFT" 40' } : {}}
      >
        {msg.content}
      </div>
    </div>
  );
}