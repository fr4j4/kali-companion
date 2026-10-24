/**
 * TerminalWidget — what Kali runs on your machine, one block per command.
 *
 * Sessions are tabs ("dev", "pruebas"). Each command is a block with its state (done, failed,
 * running, waiting for permission), its duration and a short output: a finished command shows
 * its last lines and folds the rest; a failure shows the first useful error line. When Kali asks
 * permission to run a command, the question appears inside the terminal, under the command it
 * would run.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { Loader2, Check, X, Clock, Ban, Terminal as TerminalIcon, ChevronDown, ChevronRight } from "lucide-react";
import { useStage } from "../../stage/StageProvider";
import type { TerminalSessionData, TerminalCommandEntry } from "../../hooks/useChat";
import { ansiToHtml } from "./utils/ansi";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { WidgetFooter } from "./base/WidgetChrome";
import { useShellSubtitle } from "../../stage/v2/shell";
import { ConsentCard } from "../../stage/v2/KaliZone";
import { consentTexts } from "../../lib/consentText";

const MAX_VISIBLE_LINES = 500;
/** Lines a finished command shows before "… N more lines". */
const FOLDED_LINES = 6;

interface Props {
  content?: unknown;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toLocaleString(i18n.language, { maximumFractionDigits: 1 })} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

function StatusIcon({ status, size = 15 }: { status: string; size?: number }) {
  switch (status) {
    case "running": return <Loader2 size={size} className="animate-spin text-accent" aria-hidden="true" />;
    case "done": return <Check size={size} className="text-ok" aria-hidden="true" />;
    case "error": return <X size={size} className="text-err" aria-hidden="true" />;
    case "timeout": return <Clock size={size} className="text-warn" aria-hidden="true" />;
    case "cancelled": return <Ban size={size} className="text-muted" aria-hidden="true" />;
    default: return null;
  }
}

/** The first line that looks like the reason of a failure. */
function usefulErrorIndex(lines: { text: string; stream: string }[]): number {
  const re = /(error|fail|falla|fallo|exception|traceback|not found|denied|✗|×)/i;
  const i = lines.findIndex((l) => l.stream === "stderr" || re.test(l.text));
  return i;
}

function CommandBlock({ cmd }: { cmd: TerminalCommandEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = cmd.status === "running";

  const lines = useMemo(() => {
    const all = cmd.lines;
    if (all.length <= MAX_VISIBLE_LINES) return all;
    return [...all.slice(0, 200), { stream: "stdout" as const, text: `[… ${all.length - 400} …]`, seq: -1 }, ...all.slice(-200)];
  }, [cmd.lines]);

  // A finished command shows a short window of its output: the error first, else the end.
  const folded = useMemo(() => {
    if (running || open || lines.length <= FOLDED_LINES) return { shown: lines, hidden: 0 };
    if (cmd.status === "error" || cmd.status === "timeout") {
      const at = Math.max(0, usefulErrorIndex(lines));
      const start = Math.max(0, Math.min(at - 1, lines.length - FOLDED_LINES));
      return { shown: lines.slice(start, start + FOLDED_LINES), hidden: lines.length - FOLDED_LINES };
    }
    return { shown: lines.slice(-FOLDED_LINES), hidden: lines.length - FOLDED_LINES };
  }, [lines, running, open, cmd.status]);

  useEffect(() => {
    if (running && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, running]);

  const duration = cmd.finished ? formatDuration(new Date(cmd.finished).getTime() - new Date(cmd.started).getTime()) : null;

  return (
    <section className="kw-term-block" aria-label={cmd.command}>
      <div className="kw-term-head">
        <span className="kw-term-icon"><StatusIcon status={cmd.status} /></span>
        <code className="kw-term-cmd">{cmd.command}</code>
        <span className={`kw-term-meta is-${cmd.status}`}>
          {running ? t("terminal.command.running") : duration ?? t(`terminal.command.${cmd.status}`)}
        </span>
      </div>
      {(folded.shown.length > 0 || running) && (
        <div ref={scrollRef} className={`kw-term-out ${running ? "is-live" : ""}`}>
          {folded.shown.length === 0 && running && <div className="kw-term-line is-dim">{t("v2.terminal.waiting_output")}</div>}
          {folded.shown.map((line, i) => (
            <div
              key={i}
              className={`kw-term-line ${line.stream === "stderr" ? "is-err" : ""}`}
              dangerouslySetInnerHTML={{ __html: ansiToHtml(line.text) }}
            />
          ))}
          {running && <span className="kw-term-caret" aria-hidden="true" />}
        </div>
      )}
      {(folded.hidden > 0 || open) && !running && (
        <button type="button" className="kw-term-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          {open ? t("v2.terminal.fold") : t("v2.terminal.more_lines", { count: folded.hidden })}
        </button>
      )}
      {cmd.exit_code !== null && cmd.exit_code !== 0 && !running && (
        <div className="kw-term-exit">{t("terminal.exit_code", { code: cmd.exit_code })}</div>
      )}
    </section>
  );
}

export function TerminalWidget(_props: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const sessions = chat.terminalSessions;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sessions.size === 0) { setSelectedId(null); return; }
    if (selectedId && sessions.has(selectedId)) return;
    const active = Array.from(sessions.values()).find((s) => s.status === "active");
    setSelectedId(active?.id ?? Array.from(sessions.keys())[0]);
  }, [sessions, selectedId]);

  const selected = selectedId ? sessions.get(selectedId) : null;
  useEffect(() => {
    if (selected && !selected.detailLoaded && selected.commandOrder.length === 0) chat.getTerminalSessionDetail(selected.id);
  }, [selected, chat]);

  const ordered = useMemo(() => Array.from(sessions.values()).sort((a, b) => a.created.localeCompare(b.created)), [sessions]);
  const commands = useMemo(() => (selected ? selected.commandOrder.map((id) => selected.commands.get(id)).filter(Boolean) as TerminalCommandEntry[] : []), [selected]);
  const last = commands[commands.length - 1];
  const runningCount = useMemo(() => {
    let n = 0;
    for (const s of sessions.values()) for (const c of s.commands.values()) if (c.status === "running") n++;
    return n;
  }, [sessions]);

  // The permission question for a command shows here, under the commands of its session.
  const consent = chat.consentRequest && !chat.consentRequest.handled_by_agent && (chat.consentRequest.tool === "run_command" || chat.consentRequest.tool === "run_tests")
    && (!chat.consentRequest.terminal_session_id || chat.consentRequest.terminal_session_id === selectedId)
    ? chat.consentRequest : null;
  const pendingCommand = consent ? consentTexts(consent, t as never).command || consent.tool : "";

  useEffect(() => {
    const el = bodyRef.current;
    if (el && (consent || last?.status === "running")) el.scrollTop = el.scrollHeight;
  }, [consent, last?.status, last?.lines.length]);

  useShellSubtitle(last?.cwd || selected?.display_name || null);

  if (sessions.size === 0 && !consent) {
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
    <div className="kw-term">
      {ordered.length > 0 && (
        <div className="kw-tabs" role="tablist" aria-label={t("terminal.sessions.title") as string}>
          {ordered.map((s: TerminalSessionData) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === selectedId}
              className="kw-tab"
              onClick={() => setSelectedId(s.id)}
              title={s.status === "active" ? t("terminal.session.active") as string : t("terminal.session.completed") as string}
            >
              {s.status === "active" && <span className="kw-dot is-live" aria-hidden="true" />}
              {s.display_name === "Session" ? t("terminal.title") : s.display_name}
            </button>
          ))}
        </div>
      )}
      <div ref={bodyRef} className="kw-term-body scrollbar-thin" role="log" aria-live="polite">
        {selected && commands.length === 0 && !selected.detailLoaded && (
          <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin text-accent/50" /></div>
        )}
        {commands.map((cmd) => <CommandBlock key={cmd.call_id} cmd={cmd} />)}
        {consent && (
          <section className="kw-term-block is-pending" aria-label={pendingCommand}>
            <div className="kw-term-head">
              <span className="kw-term-icon"><Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" /></span>
              <code className="kw-term-cmd">{pendingCommand}</code>
              <span className="kw-term-meta is-running">{t("v2.terminal.waiting_permission")}</span>
            </div>
            <div className="kw-term-consent">
              <ConsentCard request={consent} onRespond={chat.respondConsent} />
            </div>
          </section>
        )}
      </div>
      <WidgetFooter>
        {last?.cwd && <span className="v2-foot-item kw-mono">{last.cwd}</span>}
        <span className="v2-foot-item">{t("v2.terminal.processes", { count: runningCount })}</span>
      </WidgetFooter>
    </div>
  );
}
