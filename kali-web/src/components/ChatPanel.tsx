// ChatPanel — the scrollable message list.
//
// Auto-scrolls to the bottom when new messages arrive or while streaming.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Message } from "./Message";
import type { ChatMessage } from "../hooks/useChat";

interface Props {
  messages: ChatMessage[];
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}

export function ChatPanel({ messages, imageReadyKeys, onRequestImage }: Props) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3">
        <div className="text-5xl">🐾</div>
        <p>{t("app.welcome")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-5 flex flex-col gap-3 md:gap-4">
      {messages.map((m) => (
        <Message key={m.id} message={m} imageReadyKeys={imageReadyKeys} onRequestImage={onRequestImage} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}