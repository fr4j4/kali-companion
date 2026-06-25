import { useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { injectHashGuard } from "../artifacts/htmlUtils";
import type { ArtifactEvent } from "../../lib/protocol";

interface Props {
  content?: unknown;
}

const AUTO_SWITCH_DELAY_MS = 400;

export function HtmlWidget({ content }: Props) {
  const { t } = useTranslation();
  const event = content as ArtifactEvent | undefined;
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
  const codeRef = useRef<HTMLPreElement>(null);

  // Auto-switch to Preview after streaming completes (with delay), unless
  // the user manually switched tabs during streaming.
  useEffect(() => {
    if (isComplete && !userSwitchedRef.current && html) {
      const timer = setTimeout(() => setTab("preview"), AUTO_SWITCH_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isComplete, html]);

  // Auto-scroll the HTML source to the bottom during streaming.
  useEffect(() => {
    if (tab === "html" && isStreaming && codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [html, tab, isStreaming]);

  const handleTabClick = (newTab: "html" | "preview") => {
    userSwitchedRef.current = true;
    setTab(newTab);
  };

  return (
    <BaseWidget>
      <div className="flex flex-1 flex-col min-h-0">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-white/8 bg-white/[0.02] shrink-0">
          <TabButton active={tab === "html"} onClick={() => handleTabClick("html")}>
            {"</>"} HTML
          </TabButton>
          <TabButton active={tab === "preview"} onClick={() => handleTabClick("preview")}>
            {"\u{1F441}"} Preview
          </TabButton>
        </div>

        {/* Tab content */}
        {tab === "html" ? (
          <pre
            ref={codeRef}
            className="flex-1 min-h-0 overflow-auto bg-[#0d0d0d] text-[#d4d4d4] text-xs font-mono p-3 m-0 whitespace-pre-wrap break-words"
          >
            {html || ""}
            {isStreaming && <span className="inline-block w-2 h-3.5 bg-accent animate-pulse ml-0.5 align-middle" />}
          </pre>
        ) : isStreaming ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-white">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            <span className="text-xs text-gray-500">{t("widget.html.generating") || "Generando HTML\u2026"}</span>
          </div>
        ) : (
          <iframe
            srcDoc={injectHashGuard(html)}
            sandbox="allow-scripts allow-popups allow-forms"
            className="w-full flex-1 min-h-0 border-none bg-white"
            title={t("widget.html.title")}
          />
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