import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, CheckCircle2, XCircle, Clock, Ban, Terminal as TerminalIcon } from "lucide-react";
import { useStage } from "../../stage/StageProvider";
import type { TerminalSessionData, TerminalCommandEntry } from "../../hooks/useChat";
import { ansiToHtml } from "./utils/ansi";
import { ScrollableWidget } from "./base/ScrollableWidget";

const MAX_VISIBLE_LINES = 500;

interface Props {
  content?: unknown;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function StatusIcon({ status, size = 12 }: { status: string; size?: number }) {
  switch (status) {
    case "running":
      return <Loader2 size={size} className="animate-spin text-accent" />;
    case "done":
      return <CheckCircle2 size={size} className="text-ok" />;
    case "error":
      return <XCircle size={size} className="text-err" />;
    case "timeout":
      return <Clock size={size} className="text-warn" />;
    case "cancelled":
      return <Ban size={size} className="text-muted" />;
    default:
      return null;
  }
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
  const isAuto = session.display_name === "Session";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition border ${
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
        <span className={`text-sm truncate flex-1 ${isAuto ? "text-muted" : "text-fg"}`}>
          {session.display_name}
        </span>
      </div>
      <div className="text-xs text-muted mt-1 pl-4 flex items-center gap-1.5">
        <span>{t("terminal.command_count", { count: cmdCount })}</span>
        <span className="text-muted/40">·</span>
        <span>{formatTime(session.created)}</span>
        <span className="text-muted/40">·</span>
        <span>{isActive ? t("terminal.session.active") : t("terminal.session.completed")}</span>
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
    <div className="border-b border-white/5 last:border-0 pb-3 mb-3">
      {/* Command header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <code className="text-sm text-fg font-mono break-all">
            <span className="text-accent">$</span> {cmd.command}
          </code>
          {cmd.cwd && (
            <div className="text-xs text-muted mt-0.5 font-mono truncate">{cmd.cwd}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <StatusIcon status={cmd.status} />
          <span className={`text-xs font-mono ${
            cmd.status === "running" ? "text-accent" :
            cmd.status === "done" ? "text-ok" :
            cmd.status === "error" ? "text-err" :
            cmd.status === "timeout" ? "text-warn" : "text-muted"
          }`}>
            {t(`terminal.command.${cmd.status}`)}
          </span>
          <span className="text-xs text-muted/50">{formatTime(cmd.started)}</span>
        </div>
      </div>

      {/* Output */}
      <div ref={scrollRef} className="font-mono text-xs space-y-0.5 max-h-[300px] overflow-y-auto scrollbar-thin bg-black/20 rounded-md p-2">
        {visibleLines.length === 0 && cmd.status === "running" && (
          <div className="text-muted italic">waiting for output...</div>
        )}
        {visibleLines.map((line, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-all px-1.5 ${
              line.stream === "stderr"
                ? "border-l-2 border-err/40 text-err/80"
                : "text-fg/75"
            }`}
            dangerouslySetInnerHTML={{ __html: ansiToHtml(line.text) }}
          />
        ))}
        {cmd.status === "running" && (
          <div className="text-accent animate-pulse px-1.5">▊</div>
        )}
      </div>

      {/* Exit code */}
      {cmd.exit_code !== null && cmd.status !== "running" && (
        <div className={`text-xs mt-1.5 font-mono ${
          cmd.exit_code === 0 ? "text-ok/60" : "text-err/60"
        }`}>
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
      return b.created.localeCompare(a.created);
    });
  }, [sessions]);

  if (sessions.size === 0) {
    return (
      <ScrollableWidget searchable={false}>
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-2">
          <TerminalIcon size={28} className="text-muted/40" />
          <p className="text-sm text-muted">{t("terminal.empty")}</p>
        </div>
      </ScrollableWidget>
    );
  }

  return (
    <ScrollableWidget searchable={false}>
      <div className="flex h-full min-h-0">
        {/* Main panel */}
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
                  <span className={`text-sm font-medium truncate ${
                    selectedSession.display_name === "Session" ? "text-muted" : "text-fg"
                  }`}>
                    {selectedSession.display_name}
                  </span>
                  <span className="text-xs text-muted/50">{formatTime(selectedSession.created)}</span>
                </div>
                <button
                  onClick={() => setAutoScroll((v) => !v)}
                  className="text-xs text-muted hover:text-fg transition shrink-0 px-2 py-0.5 rounded hover:bg-white/5"
                >
                  {autoScroll ? t("terminal.autoscroll.on") : t("terminal.autoscroll.off")}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2">
                {selectedSession.commandOrder.length === 0 && !selectedSession.detailLoaded ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 size={16} className="animate-spin text-accent/50" />
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

        {/* Sidebar — session history */}
        <div className="w-[210px] shrink-0 border-l border-white/5 flex flex-col">
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