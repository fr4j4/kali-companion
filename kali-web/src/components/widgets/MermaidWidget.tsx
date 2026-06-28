import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import mermaid from "mermaid";
import { BaseWidget } from "./base/BaseWidget";
import { StreamingSpinner } from "./base/StreamingSpinner";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_MERMAID } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";
import type { ArtifactEvent } from "../../lib/protocol";

interface Props {
  content?: unknown;
}

const AUTO_SWITCH_DELAY_MS = 400;

export function MermaidWidget({ content }: Props) {
  const { t } = useTranslation();
  const event = content as ArtifactEvent | undefined;
  const phase = event?.phase;
  const isStreaming = phase === "streaming";
  const isComplete = phase === "complete" || !phase;

  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const source = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.source && typeof d.source === "string") return d.source;
    return SAMPLE_MERMAID;
  }, [d]);

  const lines = useMemo(() => source.split("\n"), [source]);

  const svgRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`);
  const [error, setError] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<"code" | "diagram">("code");
  const userSwitchedRef = useRef(false);

  // Auto-switch to diagram tab after streaming completes.
  useEffect(() => {
    if (isComplete && !userSwitchedRef.current) {
      const timer = setTimeout(() => setTab("diagram"), AUTO_SWITCH_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isComplete]);

  // Auto-scroll source during streaming.
  useEffect(() => {
    if (tab === "code" && isStreaming && codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight;
    }
  }, [source, tab, isStreaming]);

  // Render mermaid diagram when the diagram tab is visible and not streaming.
  useEffect(() => {
    if (!svgRef.current || isStreaming || tab !== "diagram") return;
    if (svgRef.current.querySelector("svg")) return;
    setError(null);
    mermaid.initialize({ startOnLoad: false, theme: "dark" });
    mermaid
      .render(idRef.current, source, svgRef.current)
      .then((r: { svg: string }) => {
        if (!svgRef.current) return;
        svgRef.current.innerHTML = r.svg;
        if (
          svgRef.current.querySelector('[aria-roledescription="error"]')
        ) {
          svgRef.current.innerHTML = "";
          setError(t("widget.mermaid.error"));
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : t("widget.mermaid.error");
        if (svgRef.current) svgRef.current.innerHTML = "";
        setError(msg);
      });
  }, [source, isStreaming, tab, t]);

  const handleTabClick = (newTab: "code" | "diagram") => {
    userSwitchedRef.current = true;
    setTab(newTab);
  };

  const actions: HeaderAction[] = useMemo(
    () => [
      { type: "copy", getContent: () => source, tip: t("widget.mermaid.copy_source") },
      { type: "download", content: source, filename: "diagram.mmd", tip: t("widget.mermaid.download") },
    ],
    [source, t]
  );

  const { rendered: headerActions } = useHeaderActions(actions);

  const startPointerPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    const onMove = (ev: PointerEvent) => {
      setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener(
      "pointerup",
      () => {
        target.removeEventListener("pointermove", onMove);
      },
      { once: true }
    );
  };

  return (
    <BaseWidget>
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex items-center gap-0 border-b border-white/8 bg-white/[0.02] shrink-0" style={{ position: "relative", zIndex: 1 }}>
          <TabButton active={tab === "code"} onClick={() => handleTabClick("code")}>
            {"\u{1F4DD}"} {t("widget.mermaid.source")}
          </TabButton>
          <TabButton active={tab === "diagram"} onClick={() => handleTabClick("diagram")}>
            {"\u{1F52E}"} {t("widget.mermaid.preview")}
          </TabButton>
          <div className="ml-auto flex items-center gap-0.5 px-2 py-1">
            {headerActions}
          </div>
        </div>

        {tab === "code" ? (
          <>
            <div className="flex flex-1 min-h-0 overflow-y-auto">
              <div className="text-right px-2 py-3 text-xs text-muted/40 select-none font-mono leading-5 shrink-0 border-r border-white/5">
                {lines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre
                ref={codeRef}
                className="flex-1 p-3 text-xs font-mono leading-5 overflow-x-auto m-0 text-[#d4d4d4]"
                style={{ whiteSpace: "pre" }}
              >
                {source}
                {isStreaming && (
                  <span className="inline-block w-2 h-3.5 bg-accent animate-pulse ml-0.5 align-middle" />
                )}
              </pre>
            </div>
            <div className="px-3 py-1.5 border-t border-white/5 flex items-center gap-3 text-[10px] text-muted/60 shrink-0">
              <span className="badge">mermaid</span>
              <span>{t("widget.code.lines", { count: lines.length })}</span>
              {error && <span className="text-red-400 ml-auto truncate">{error}</span>}
            </div>
          </>
        ) : isStreaming ? (
          <StreamingSpinner content={content} windowType="mermaid" />
        ) : (
          <div
            className="mermaid-container flex-1 min-h-0 overflow-hidden"
            ref={containerRef}
            onWheel={(e) => {
              setZoom((z) => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
            }}
            onPointerDown={startPointerPan}
            style={{
              cursor: "grab",
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <div ref={svgRef} />
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
