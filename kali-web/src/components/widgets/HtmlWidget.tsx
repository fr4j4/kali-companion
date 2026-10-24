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
import { Terminal, Code2, Eye, Smartphone, Tablet, Monitor, Link2, RotateCw } from "lucide-react";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShellSubtitle } from "../../stage/v2/shell";

const AUTO_SWITCH_DELAY_MS = 400;

type Viewport = "mobile" | "tablet" | "desktop";
const VIEWPORTS: Record<Exclude<Viewport, "desktop">, number> = { mobile: 390, tablet: 768 };
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

  const [viewport, setViewport] = useState<Viewport>("desktop");
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameW, setFrameW] = useState(0);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);
  const vpWidth = viewport === "desktop" ? null : VIEWPORTS[viewport];
  const shownWidth = vpWidth ?? frameW;
  const sections = useMemo(() => (html.match(/<section\b/gi) ?? []).length, [html]);
  const address = typeof data === "object" && data && typeof (data as Record<string, unknown>).url === "string"
    ? String((data as Record<string, unknown>).url)
    : `${(event?.title || "artifact").toLowerCase().replace(/[^\w\-]+/g, "-")}.html`;

  useShellSubtitle(tab === "preview" ? t(`v2.web.${viewport}`, { width: Math.round(shownWidth) }) : t("widget.html.tab_code"));

  return (
    <BaseWidget>
      <WidgetToolbar>
        <button
          type="button"
          className="tooltip w-6 h-6 rounded hover:bg-fg/10 text-muted hover:text-accent transition flex items-center justify-center"
          data-tip={tab === "preview" ? t("widget.html.tab_code") : t("widget.html.tab_preview")}
          aria-label={(tab === "preview" ? t("widget.html.tab_code") : t("widget.html.tab_preview")) as string}
          onClick={() => handleTabClick(tab === "preview" ? "html" : "preview")}
        >
          {tab === "preview" ? <Code2 size={14} /> : <Eye size={14} />}
        </button>
        {headerActions}
      </WidgetToolbar>
      <div className="flex flex-1 flex-col min-h-0">
        <div className="kw-web-bar">
          <div className="kw-seg" role="group" aria-label={t("v2.web.viewport") as string}>
            {(["mobile", "tablet", "desktop"] as Viewport[]).map((v) => {
              const Icon = v === "mobile" ? Smartphone : v === "tablet" ? Tablet : Monitor;
              return (
                <button key={v} type="button" aria-pressed={viewport === v} title={t(`v2.web.${v}_short`) as string} aria-label={t(`v2.web.${v}_short`) as string} onClick={() => { setViewport(v); if (tab !== "preview") handleTabClick("preview"); }}>
                  <Icon size={14} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="kw-address"><Link2 size={13} aria-hidden="true" /><span className="truncate">{address}</span></div>
          <button type="button" className="v2-icon-btn sm" onClick={handleRefresh} aria-label={t("widget.html.refresh") as string} title={t("widget.html.refresh") as string}>
            <RotateCw size={14} aria-hidden="true" />
          </button>
        </div>

        {tab === "html" ? (
          <div ref={codeRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
            <CodeViewer code={html} language="html" isStreaming={isStreaming} />
          </div>
        ) : (
          <div ref={frameRef} className="kw-web-stage">
            <div className="kw-web-frame" style={vpWidth ? { width: Math.min(vpWidth, frameW || vpWidth) } : undefined}>
              {isStreaming ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span className="text-xs text-gray-500">{t("window.streaming.html")}</span>
                </div>
              ) : (
                <iframe
                  key={renderKey}
                  ref={iframeRef}
                  srcDoc={srcDoc}
                  sandbox="allow-scripts allow-popups allow-forms allow-modals"
                  className="w-full border-none bg-white flex-1 min-h-0"
                  title={t("widget.html.title")}
                />
              )}
            </div>
          </div>
        )}
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{isStreaming ? t("v2.web.updating") : t("v2.web.ready")}</span>
        {sections > 0 && <span className="v2-foot-item">{t("v2.web.sections", { count: sections })}</span>}
        {errorCount > 0 && <span className="v2-foot-item is-warn">{t("v2.web.console", { count: errorCount })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
