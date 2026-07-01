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

import { useSidePanel } from "../../stage/SidePanelContext";
import { HtmlConsolePanel, type ConsoleEntry } from "./HtmlConsolePanel";
import { Terminal } from "lucide-react";

const AUTO_SWITCH_DELAY_MS = 400;
const MAX_CONSOLE_LOGS = 500;

interface Props {
  content?: unknown;
}

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

  const { setSidePanelContent, clearSidePanel } = useSidePanel();

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

  // Register the console in the window's side panel.
  useEffect(() => {
    setSidePanelContent({
      icon: <Terminal size={14} />,
      title: "Console",
      onClear: handleConsoleClear,
      badge: errorCount,
      content: <HtmlConsolePanel logs={consoleLogs} onClear={handleConsoleClear} />,
    });
  }, [consoleLogs, handleConsoleClear, setSidePanelContent, errorCount]);

  // Clear side panel on widget unmount only.
  useEffect(() => {
    return () => {
      clearSidePanel();
    };
  }, [clearSidePanel]);

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
              className="w-full border-none bg-white flex-1 min-h-0"
              title={t("widget.html.title")}
            />
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
