import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStage } from "../../stage/StageProvider";
import type { TerminalSessionData, TerminalCommandEntry } from "../../hooks/useChat";
import { ansiToHtml } from "./utils/ansi";
import { ScrollableWidget } from "./base/ScrollableWidget";

const MAX_VISIBLE_LINES = 500;

interface Props {
  content?: unknown;
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    running: "text-accent animate-pulse",
    done: "text-ok",
    error: "text-err",
    timeout: "text-warn",
    cancelled: "text-muted",
  };
  const icons: Record<string, string> = {
    running: "⟳",
    done: "✓",
    error: "✗",
    timeout: "⏱",
    cancelled: "⊘",
  };
  return (
    <span className={`text-xs font-mono ${styles[status] || "text-muted"}`}>
      {icons[status] || "?"} {t(`terminal.command.${status}`)}
    </span>
  );
}

function SessionListItem({
  session,
  isSelected,
  onClick,
  t,
}: {
  session: TerminalSessionData;
  isSelected: boolean;
  onClick: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const isActive = session.status === "active";
  const cmdCount = session.commandOrder.length;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg transition border ${
        isSelected
          ? "bg-accent/10 border-accent/30"
          : "bg-white/[0.02] border-transparent hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isActive ? "bg-accent animate-pulse" : "bg-ok"
          }`}
        />
        <span className="text-sm text-fg truncate flex-1">{session.display_name}</span>
      </div>
      <div className="text-xs text-muted mt-1 pl-4">
        {t("terminal.command_count", { count: cmdCount })} ·{" "}
        {isActive ? t("terminal.session.active") : t("terminal.session.completed")}
      </div>
    </button>
  );
}

function CommandBlock({
  cmd,
  t,
}: {
  cmd: TerminalCommandEntry;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleLines = useMemo(() => {
    const lines = cmd.lines;
    if (lines.length <= MAX_VISIBLE_LINES) return lines;
    const head = lines.slice(0, 200);
    const tail = lines.slice(-200);
    return [...head, { stream: "stdout" as const, text: `[... truncated ${lines.length - 400} lines ...]`, seq: -1 }, ...tail];
  }, [cmd.lines]);

  useEffect(() => {
    if (cmd.status === "running" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLines, cmd.status]);

  return (
    <div className="border-b border-white/5 last:border-0 pb-2 mb-2">
      <div className="flex items-center justify-between mb-1">
        <code className="text-sm text-fg font-mono break-all">$ {cmd.command}</code>
        <StatusBadge status={cmd.status} t={t} />
      </div>
      <div ref={scrollRef} className="font-mono text-xs space-y-0.5 max-h-[300px] overflow-y-auto scrollbar-thin">
        {visibleLines.map((line, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all ${
              line.stream === "stderr" ? "text-err/80" : "text-fg/80"
            }`}
            dangerouslySetInnerHTML={{ __html: ansiToHtml(line.text) }}
          />
        ))}
        {cmd.status === "running" && (
          <div className="text-accent animate-pulse">▊</div>
        )}
      </div>
      {cmd.exit_code !== null && cmd.status !== "running" && (
        <div className="text-xs text-muted mt-1">
          {t("terminal.exit_code", { code: cmd.exit_code })}
        </div>
      )}
    </div>
  );
}

export function TerminalWidget(_props: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const sessions = chat.terminalSessions;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (sessions.size === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && sessions.has(selectedId)) return;
    const active = Array.from(sessions.values()).find((s) => s.status === "active");
    setSelectedId(active?.id ?? Array.from(sessions.keys())[0]);
  }, [sessions, selectedId]);

  const selectedSession = selectedId ? sessions.get(selectedId) : null;
  useEffect(() => {
    if (selectedSession && !selectedSession.detailLoaded && selectedSession.commandOrder.length === 0) {
      chat.getTerminalSessionDetail(selectedSession.id);
    }
  }, [selectedSession, chat]);

  const sortedSessions = useMemo(() => {
    return Array.from(sessions.values()).sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (a.status !== "active" && b.status === "active") return 1;
      return a.created.localeCompare(b.created);
    });
  }, [sessions]);

  if (sessions.size === 0) {
    return (
      <ScrollableWidget searchable={false}>
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm text-muted">{t("terminal.empty")}</p>
        </div>
      </ScrollableWidget>
    );
  }

  return (
    <ScrollableWidget searchable={false}>
      <div className="flex h-full min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedSession && (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      selectedSession.status === "active" ? "bg-accent animate-pulse" : "bg-ok"
                    }`}
                  />
                  <span className="text-sm font-medium text-fg truncate">
                    {selectedSession.display_name}
                  </span>
                </div>
                <button
                  onClick={() => setAutoScroll((v) => !v)}
                  className="text-xs text-muted hover:text-fg transition shrink-0"
                >
                  {autoScroll ? t("terminal.autoscroll.on") : t("terminal.autoscroll.off")}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2">
                {selectedSession.commandOrder.length === 0 && !selectedSession.detailLoaded ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  </div>
                ) : selectedSession.commandOrder.length === 0 ? (
                  <p className="text-sm text-muted text-center py-4">{t("terminal.no_sessions")}</p>
                ) : (
                  selectedSession.commandOrder.map((callId) => (
                    <CommandBlock
                      key={callId}
                      cmd={selectedSession.commands.get(callId)!}
                      t={t}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="w-[200px] shrink-0 border-l border-white/5 flex flex-col">
          <div className="px-3 py-2 border-b border-white/5 shrink-0">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">
              {t("terminal.sessions.title")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2 space-y-1">
            {sortedSessions.map((sess) => (
              <SessionListItem
                key={sess.id}
                session={sess}
                isSelected={sess.id === selectedId}
                onClick={() => setSelectedId(sess.id)}
                t={t}
              />
            ))}
          </div>
        </div>
      </div>
    </ScrollableWidget>
  );
}