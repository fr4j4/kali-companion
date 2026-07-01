import { useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Brain } from "lucide-react";
import { marked } from "marked";
import { useStage } from "./StageProvider";
import { Overlay } from "../components/ui/Overlay";
import type { ChatMessage } from "../hooks/useChat";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ConversationModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, chat.messages]);

  const messages = chat.messages.filter((m) => m.content || m.toolEvent);

  return (
    <Overlay
      open={open}
      onClose={onClose}
      variant="modal"
      size="xl"
      title={t("conversation.title")}
    >
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin -mx-5 -mb-5 p-5 space-y-3">
        {messages.length === 0 && (
          <p className="text-muted text-sm text-center py-8">
            {t("conversation.empty")}
          </p>
        )}
        {messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} />
        ))}
      </div>
    </Overlay>
  );
}

function MessageRow({ msg }: { msg: ChatMessage }) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";

  const assistantHtml = useMemo(() => {
    if (isUser || !msg.content) return null;
    try {
      return marked.parse(msg.content, { async: false }) as string;
    } catch {
      return `<p>${msg.content}</p>`;
    }
  }, [msg.content, isUser]);

  if (msg.toolEvent && !msg.content) {
    const { tool, status, params, output } = msg.toolEvent;
    const command = params?.command as string | undefined;

    if (status === "running" && command) {
      return (
        <div className="flex flex-col gap-1 py-1 px-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="badge px-1.5 py-0.5 rounded bg-accent/10 text-accent">
              {tool}
            </span>
            <span className="text-muted/60">{t("tool.running")}</span>
          </div>
          <code className="text-muted/80 bg-muted/10 px-2 py-1 rounded max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
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
            <span className="badge px-1.5 py-0.5 rounded bg-accent/10 text-accent">
              {tool}
            </span>
            <span className="text-muted/60">{t(`tool.${status}`)}</span>
            {command && (
              <span className="text-muted/40 truncate max-w-[200px]" title={command}>
                {command}
              </span>
            )}
          </div>
          {displayOutput && (
            <pre className="text-muted/70 bg-muted/10 px-2 py-1.5 rounded overflow-x-auto scrollbar-thin max-h-32 whitespace-pre-wrap break-all">
              {displayOutput.slice(0, 2000)}
            </pre>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 text-xs text-muted py-1 px-2">
        <span className="badge px-1.5 py-0.5 rounded bg-accent/10 text-accent">
          {tool}
        </span>
        <span className="text-muted/60">
          {t(`tool.${status}`) || status}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}>
      <span className="text-[10px] text-muted/40 badge px-1">
        {isUser ? t("conversation.you") : t("assistant.name")}
      </span>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-user-bubble text-fg rounded-br-md italic"
            : "bg-assistant-bubble border border-border text-fg rounded-bl-md"
        }`}
        style={!isUser ? { fontFamily: "Fraunces, serif", fontVariationSettings: '"SOFT" 40' } : {}}
      >
        {isUser ? msg.content : (
          <div className="prose-md" dangerouslySetInnerHTML={{ __html: assistantHtml || "" }} />
        )}
      </div>
      {!isUser && msg.reasoning && (
        <div className="mt-1 max-w-[85%] px-3 py-2 rounded-xl border border-dashed border-muted/40 text-xs italic text-muted/70 leading-relaxed bg-muted/5">
          <div className="flex items-center gap-1.5 mb-1 not-italic">
            <Brain size={11} className="text-accent" />
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              {t("reasoning.thought")}
            </span>
          </div>
          {msg.reasoning}
        </div>
      )}
    </div>
  );
}
