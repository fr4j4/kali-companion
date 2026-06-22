// Message — a single chat bubble (user or assistant).
//
// Renders markdown for assistant messages (via marked), plain text for
// user messages. Shows a streaming cursor while the assistant is typing.

import { useMemo } from "react";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import { useTranslation } from "react-i18next";
import "highlight.js/styles/github-dark.css";
import type { ToolEvent } from "../lib/protocol";
import type { ChatMessage } from "../hooks/useChat";
import { WidgetGrid } from "./artifacts/WidgetGrid";

interface Props {
  message: ChatMessage;
  imageReadyKeys?: Set<string>;
  onRequestImage?: (key: string) => void;
}

marked.use(markedHighlight({
  langPrefix: "hljs language-",
  highlight(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : "plaintext";
    return hljs.highlight(code, { language }).value;
  },
}));
marked.setOptions({ breaks: true, gfm: true });

function renderToolEvent(ev: ToolEvent, t: (key: string, opts?: Record<string, unknown>) => string) {
  const icon = ev.status === "running" ? "⚙️" : ev.status === "success" ? "✅" : "❌";
  const key = ev.status === "running" ? "tool.running" : ev.status === "success" ? "tool.success" : "tool.error";
  return (
    <div className="flex gap-2.5 max-w-[85%] xs:max-w-[80%] md:max-w-[75%]">
      <div className="text-lg self-start mt-0.5 shrink-0">🐾</div>
      <div className="msg-bubble flex flex-col gap-1 text-sm border-l-3 border-accent pl-3">
        <span className="text-sm">{icon}</span>
        <span className="text-muted italic text-xs">{t(key, { tool: ev.tool })}</span>
        {ev.status !== "running" && ev.output != null && (
          <details className="tool-output">
            <summary>Output</summary>
            <pre>{typeof ev.output === "string" ? ev.output : JSON.stringify(ev.output, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export function Message({ message, imageReadyKeys, onRequestImage }: Props) {
  const { t } = useTranslation();

  const html = useMemo(() => {
    if (message.role === "user" || message.toolEvent) return null;
    return marked.parse(message.content, { async: false }) as string;
  }, [message.content, message.role, message.toolEvent]);

  if (message.toolEvent) {
    return (
      <>
        {renderToolEvent(message.toolEvent, t)}
        {message.inlineArtifacts && message.inlineArtifacts.length > 0 && (
          <div className="flex gap-2.5 max-w-[85%] xs:max-w-[80%] md:max-w-[75%]">
            <div className="text-lg self-start mt-0.5 shrink-0">🐾</div>
            <div className="space-y-2">
              {message.inlineArtifacts.map((art) => (
                art.type === "widget" ? (
                  <WidgetGrid key={art.id} content={art.content} imageReadyKeys={imageReadyKeys} onRequestImage={onRequestImage} />
                ) : null
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex gap-2.5 max-w-[85%] xs:max-w-[80%] md:max-w-[75%] self-end flex-row-reverse">
        <div className="msg-bubble user-bubble">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5 max-w-[85%] xs:max-w-[80%] md:max-w-[75%]">
      <div className="text-lg self-start mt-0.5 shrink-0">🐾</div>
      <div className="msg-bubble assistant-bubble">
        {message.reasoning && (
          <details className="reasoning-panel">
            <summary>{t("reasoning.thinking")}</summary>
            <div className="reasoning-text">{message.reasoning}</div>
          </details>
        )}
        {html ? (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className="msg-empty" />
        )}
        {message.inlineArtifacts && message.inlineArtifacts.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.inlineArtifacts.map((art) => (
              art.type === "widget" ? (
                <WidgetGrid key={art.id} content={art.content} imageReadyKeys={imageReadyKeys} onRequestImage={onRequestImage} />
              ) : null
            ))}
          </div>
        )}
        {message.streaming && <span className="streaming-cursor" />}
      </div>
    </div>
  );
}