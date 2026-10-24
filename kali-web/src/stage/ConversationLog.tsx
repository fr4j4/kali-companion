import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, Brain, Check, Copy } from "lucide-react";
import { renderMarkdown } from "../lib/markdown";
import { useStage } from "./StageProvider";
import { StateMessage } from "../components/ui/StateMessage";
import { toolIcon, toolLabel } from "../lib/toolLabels";
import type { ChatMessage } from "../hooks/useChat";

/** Scrollable message log, shared by the docked chat panel and the conversation modal. */
export function ConversationLog({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const messages = chat.messages.filter((m) => m.content || m.toolEvent);

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setShowJump(false);
  }, []);

  useEffect(() => { if (active) scrollToEnd(); }, [active, scrollToEnd]);
  useEffect(() => {
    if (stickRef.current) scrollToEnd();
    else setShowJump(true);
  }, [chat.messages, scrollToEnd]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickRef.current = atEnd;
    if (atEnd) setShowJump(false);
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite" className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <StateMessage kind="empty" title={t("conversation.empty") as string} className="py-8" />
        )}
        {messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}
        {chat.isThinking && messages[messages.length - 1]?.streaming !== true && (
          <div className="flex items-center gap-2 px-1 text-xs text-muted" role="status">
            <span className="flex gap-1" aria-hidden="true"><span className="kali-typing-dot" /><span className="kali-typing-dot" /><span className="kali-typing-dot" /></span>
            {t("stage.thinking")}
          </div>
        )}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={scrollToEnd}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1.5 text-xs text-fg shadow-lg hover:border-accent/50"
        >
          <ArrowDown size={12} aria-hidden="true" />
          {t("chat.jump_to_latest")}
        </button>
      )}
    </div>
  );
}

function MessageRow({ msg }: { msg: ChatMessage }) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(msg.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  };

  const assistantHtml = useMemo(() => {
    if (isUser || !msg.content) return null;
    return renderMarkdown(msg.content);
  }, [msg.content, isUser]);

  if (msg.toolEvent && !msg.content) {
    const { tool, status, params, output } = msg.toolEvent;
    const command = params?.command as string | undefined;
    // Human name and icon, never the internal tool name.
    const label = toolLabel(t as never, tool);
    const Icon = toolIcon(tool, params);
    const head = (
      <span className="flex items-center gap-2 min-w-0">
        <Icon size={14} aria-hidden="true" className={status === "error" ? "text-err shrink-0" : "text-accent shrink-0"} />
        <span className="text-muted truncate">{t(`tool.${status}`, { tool: label, defaultValue: label })}</span>
      </span>
    );

    if (status === "running" && command) {
      return (
        <div className="flex flex-col gap-1 py-1 px-2 text-xs">
          {head}
          <code className="text-muted/80 bg-muted/10 px-2 py-1 rounded-lg max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
            {command}
          </code>
        </div>
      );
    }

    if ((status === "success" || status === "error") && output) {
      const outputObj = output as { stdout?: string; stderr?: string; error?: string };
      const displayOutput = outputObj.stdout || outputObj.stderr || outputObj.error || String(output);

      return (
        <div className="flex flex-col gap-1 py-1 px-2 text-xs">
          <div className="flex items-center gap-2">
            {head}
            {command && (
              <span className="text-muted/60 truncate max-w-[200px] font-mono" title={command}>
                {command}
              </span>
            )}
          </div>
          {displayOutput && (
            <pre className="text-muted/70 bg-muted/10 px-2 py-1.5 rounded-lg overflow-x-auto scrollbar-thin max-h-32 whitespace-pre-wrap break-all">
              {displayOutput.slice(0, 2000)}
            </pre>
          )}
        </div>
      );
    }

    return <div className="flex items-center gap-2 text-xs py-1 px-2">{head}</div>;
  }

  return (
    <div className={`group flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {!isUser && (
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
          {t("assistant.name")}
          {msg.content && (
            <button type="button" className="rounded p-0.5 text-muted/70 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg" onClick={copy} aria-label={t("chat.copy_message") as string} title={t("chat.copy_message") as string}>
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            </button>
          )}
        </span>
      )}
      <div
        className={isUser
          ? "max-w-[88%] rounded-2xl rounded-br-md bg-user-bubble px-3.5 py-2 text-sm leading-relaxed text-fg whitespace-pre-wrap break-words"
          : "chat-md w-full min-w-0 text-sm leading-relaxed text-fg"}
      >
        {isUser ? msg.content : (
          <div className="prose-md" dangerouslySetInnerHTML={{ __html: assistantHtml || "" }} />
        )}
      </div>
      {!isUser && msg.reasoning && (
        <details className="mt-0.5 w-full rounded-lg border border-dashed border-border bg-fg/[0.03] px-3 py-2 text-xs text-muted leading-relaxed">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium">
            <Brain size={12} className="text-accent" aria-hidden="true" />
            {t("reasoning.thought")}
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap">{msg.reasoning}</p>
        </details>
      )}
    </div>
  );
}
