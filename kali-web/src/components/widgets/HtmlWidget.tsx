import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import "highlight.js/styles/github-dark.css";
import { BaseWidget } from "./base/BaseWidget";
import { CodeViewer } from "./base/CodeViewer";
import { parseContent } from "./base/DataWidget";
import { injectHashGuard } from "../artifacts/htmlUtils";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { useStage } from "../../stage/StageProvider";
import type { ArtifactEvent } from "../../lib/protocol";

interface Props {
  content?: unknown;
}

interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  message: string;
  timestamp: number;
}

const AUTO_SWITCH_DELAY_MS = 400;
const MAX_CONSOLE_LOGS = 500;

const LEVEL_COLORS: Record<string, string> = {
  log: "text-white/80",
  info: "text-blue-300",
  warn: "text-yellow-300",
  error: "text-red-300",
  debug: "text-white/40",
};

const LEVEL_BADGES: Record<string, string> = {
  log: "bg-white/10",
  info: "bg-blue-500/20",
  warn: "bg-yellow-500/20",
  error: "bg-red-500/20",
  debug: "bg-white/5",
};

export function HtmlWidget({ content }: Props) {
  const { t } = useTranslation();
  const { chat } = useStage();
  const event = content as ArtifactEvent | undefined;
  const artifactId = event?.id;
  const phase = event?.phase;
  const isStreaming = phase === "streaming";
  const isComplete = phase === "complete" || !phase;

  const { data } = useMemo(() => parseContent(content), [content]);
  const html = useMemo(() => {
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "content" in (data as Record<string, unknown>)) {
      return String((data as Record<string, unknown>).content);
    }
    return "";
  }, [data]);

  const [tab, setTab] = useState<"html" | "preview">("preview");
  const userSwitchedRef = useRef(false);
  const codeRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [renderKey, setRenderKey] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  // Keep a ref in sync with consoleLogs so the agent's log request handler
  // (which runs outside React's render cycle) always reads the latest logs.
  const consoleLogsRef = useRef<ConsoleEntry[]>([]);
  useEffect(() => { consoleLogsRef.current = consoleLogs; }, [consoleLogs]);

  // Register this widget as the console-log provider for its artifact id.
  // The agent calls get_artifact_console → backend emits console_request →
  // useChat reads this getter and sends the logs back.
  useEffect(() => {
    if (!artifactId) return;
    chat.registerConsoleProvider(artifactId, () => consoleLogsRef.current);
    return () => chat.registerConsoleProvider(artifactId, null);
  }, [artifactId, chat]);

  const handleRefresh = useCallback(() => {
    setRenderKey((k) => k + 1);
    setConsoleLogs([]);
    setErrorCount(0);
  }, []);

  const handleConsoleClear = useCallback(() => {
    setConsoleLogs([]);
    setErrorCount(0);
  }, []);

  const actions: HeaderAction[] = useMemo(
    () => [
      { type: "copy", getContent: () => html, tip: t("widget.html.copy_source") },
      {
        type: "download",
        content: html,
        filename: event?.title ? `${event.title}.html` : "artifact.html",
        tip: t("widget.html.download"),
      },
    ],
    [html, event?.title, t]
  );

  const { rendered: headerActions } = useHeaderActions(actions);

  useEffect(() => {
    if (isComplete && !userSwitchedRef.current && html) {
      const timer = setTimeout(() => setTab("preview"), AUTO_SWITCH_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isComplete, html]);

  useEffect(() => {
    if (tab === "html" && isStreaming && codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [html, tab, isStreaming]);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleLogs]);

  useEffect(() => {
    const handler = (msg: MessageEvent) => {
      if (msg.data?.type !== "kali:console") return;
      if (msg.source !== iframeRef.current?.contentWindow) return;
      const entry: ConsoleEntry = {
        level: msg.data.level,
        message: msg.data.message,
        timestamp: msg.data.timestamp ?? Date.now(),
      };
      setConsoleLogs((prev) => {
        const next = [...prev, entry];
        if (next.length > MAX_CONSOLE_LOGS) next.shift();
        return next;
      });
      if (msg.data.level === "error" || msg.data.level === "warn") {
        setErrorCount((c) => c + 1);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleTabClick = (newTab: "html" | "preview") => {
    userSwitchedRef.current = true;
    setTab(newTab);
  };

  const srcDoc = useMemo(
    () => injectHashGuard(html, true),
    [html, renderKey]
  );

  return (
    <BaseWidget>
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex items-center gap-0 border-b border-white/8 bg-white/[0.02] shrink-0">
          <TabButton active={tab === "html"} onClick={() => handleTabClick("html")}>
            {"</>"} {t("widget.html.tab_code")}
          </TabButton>
          <TabButton active={tab === "preview"} onClick={() => handleTabClick("preview")}>
            {"\u{1F441}"} {t("widget.html.tab_preview")}
          </TabButton>
          <div className="ml-auto flex items-center gap-0.5 px-2 py-1">
            <button
              onClick={handleRefresh}
              className="w-6 h-6 rounded hover:bg-white/10 text-muted hover:text-fg transition flex items-center justify-center"
              aria-label={t("widget.html.refresh") ?? "Refresh"}
              title={t("widget.html.refresh") ?? "Refresh"}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button
              onClick={() => setConsoleOpen((o) => !o)}
              className={`w-6 h-6 rounded hover:bg-white/10 transition flex items-center justify-center relative ${
                consoleOpen ? "text-accent bg-white/[0.06]" : "text-muted hover:text-fg"
              }`}
              aria-label={t("widget.html.toggle_console") ?? "Console"}
              title={t("widget.html.toggle_console") ?? "Console"}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              {errorCount > 0 && !consoleOpen && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center">
                  {errorCount > 9 ? "9+" : errorCount}
                </span>
              )}
            </button>
            {headerActions}
          </div>
        </div>

        {tab === "html" ? (
          <div ref={codeRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
            <CodeViewer code={html} language="html" isStreaming={isStreaming} />
          </div>
        ) : isStreaming ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-white">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            <span className="text-xs text-gray-500">{t("window.streaming.html")}</span>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 relative">
            <iframe
              key={renderKey}
              ref={iframeRef}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-popups allow-forms allow-modals"
              className={`w-full border-none bg-white ${consoleOpen ? "flex-1 min-h-0" : "flex-1 min-h-0"}`}
              title={t("widget.html.title")}
            />
            {consoleOpen && (
              <div className="shrink-0 border-t border-white/10 bg-[#0d0d0d] flex flex-col" style={{ height: "160px" }}>
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/8 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Console</span>
                    <span className="text-[10px] text-muted">{consoleLogs.length} entries</span>
                  </div>
                  <button
                    onClick={handleConsoleClear}
                    className="text-[10px] text-muted hover:text-fg transition px-2 py-0.5 rounded hover:bg-white/10"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5 scrollbar-thin">
                  {consoleLogs.length === 0 && (
                    <div className="text-white/20 italic text-center pt-6">No console output</div>
                  )}
                  {consoleLogs.map((entry, i) => (
                    <div key={i} className={`flex items-start gap-2 ${LEVEL_COLORS[entry.level] ?? "text-white/80"}`}>
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none ${LEVEL_BADGES[entry.level] ?? "bg-white/10"}`}
                      >
                        {entry.level}
                      </span>
                      <span className="whitespace-pre-wrap break-all leading-[1.4]">{entry.message}</span>
                    </div>
                  ))}
                  <div ref={consoleEndRef} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </BaseWidget>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
        active
          ? "border-accent text-fg bg-white/[0.04]"
          : "border-transparent text-muted hover:text-fg hover:bg-white/[0.02]"
      }`}
    >
      {children}
    </button>
  );
}
