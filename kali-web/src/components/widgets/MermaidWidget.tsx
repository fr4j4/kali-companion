/**
 * MermaidWidget — a diagram on a dotted board. Nodes take the theme's surfaces, the accent marks
 * the lines, decisions use the second accent. Drag to move, wheel or the buttons to zoom, and "fit"
 * to see it whole. The source opens from the header; while Kali writes it, the source shows.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Code2, Eye, Minus, Plus, Maximize } from "lucide-react";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";
import { useTranslation } from "react-i18next";
import mermaid from "mermaid";
import { BaseWidget } from "./base/BaseWidget";
import { CodeViewer } from "./base/CodeViewer";
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

  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const { compact } = useShell();
  const d = (data ?? {}) as Record<string, unknown>;
  const source = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.source && typeof d.source === "string") return d.source;
    return SAMPLE_MERMAID;
  }, [d]);


  const svgRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
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
    mermaid.initialize(mermaidConfig());
    mermaid
      .render(idRef.current, source, svgRef.current)
      .then((r: { svg: string }) => {
        if (!svgRef.current) return;
        svgRef.current.innerHTML = r.svg;
        // Draw at the diagram's own size (mermaid squeezes it to 100 % of a shrinking box), then fit.
        const svg = svgRef.current.querySelector("svg");
        const vb = svg?.viewBox.baseVal;
        if (svg && vb && vb.width) {
          svg.style.maxWidth = "none";
          svg.setAttribute("width", String(vb.width));
          svg.setAttribute("height", String(vb.height));
          requestAnimationFrame(() => fitRef.current());
        }
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

  const fitRef = useRef<() => void>(() => {});
  const fit = useCallback(() => {
    const box = containerRef.current;
    const svg = svgRef.current?.querySelector("svg");
    if (!box || !svg) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const vb = svg.viewBox.baseVal;
    const w = vb?.width || svg.getBoundingClientRect().width / zoom;
    const h = vb?.height || svg.getBoundingClientRect().height / zoom;
    const z = Math.max(0.3, Math.min(1.5, Math.min((box.clientWidth - 48) / w, (box.clientHeight - 48) / h)));
    setZoom(z);
    setPan({ x: 0, y: 0 });
  }, [zoom]);
  fitRef.current = fit;

  const stats = useMemo(() => diagramStats(source), [source]);
  useShellSubtitle(tab === "code" ? t("widget.mermaid.source") : stats.kind);
  useShellSample(!isReal);

  return (
    <BaseWidget>
      <WidgetToolbar>
        <button
          type="button"
          className="tooltip w-6 h-6 rounded hover:bg-fg/10 text-muted hover:text-accent transition flex items-center justify-center"
          data-tip={tab === "diagram" ? t("widget.mermaid.source") : t("widget.mermaid.preview")}
          aria-label={(tab === "diagram" ? t("widget.mermaid.source") : t("widget.mermaid.preview")) as string}
          onClick={() => handleTabClick(tab === "diagram" ? "code" : "diagram")}
        >
          {tab === "diagram" ? <Code2 size={14} /> : <Eye size={14} />}
        </button>
        {headerActions}
      </WidgetToolbar>
      <div className="flex flex-1 flex-col min-h-0">
        {tab === "code" ? (
          <div ref={codeRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
            <CodeViewer code={source} language="plaintext" isStreaming={isStreaming} />
          </div>
        ) : isStreaming ? (
          <StreamingSpinner content={content} windowType="mermaid" />
        ) : (
          <div
            className="kw-board"
            ref={containerRef}
            onWheel={(e) => setZoom((z) => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)))}
            onPointerDown={startPointerPan}
            onDoubleClick={fit}
          >
            <div className="kw-board-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <div ref={svgRef} />
            </div>
            {error && <p className="kw-board-error">{error}</p>}
            {!compact && (
              <div className="kw-zoom" onPointerDown={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} aria-label={t("v2.zoom.out") as string}><Minus size={14} /></button>
                <span className="kw-mono">{Math.round(zoom * 100)} %</span>
                <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} aria-label={t("v2.zoom.in") as string}><Plus size={14} /></button>
                <button type="button" onClick={fit} aria-label={t("v2.zoom.fit") as string} title={t("v2.zoom.fit") as string}><Maximize size={14} /></button>
              </div>
            )}
          </div>
        )}
      </div>
      <WidgetFooter>
        {stats.nodes > 0 && <span className="v2-foot-item">{t("v2.diagram.steps", { count: stats.nodes })}</span>}
        {stats.decisions > 0 && <span className="v2-foot-item">{t("v2.diagram.decisions", { count: stats.decisions })}</span>}
        <span className="v2-foot-item">{t("v2.diagram.zoom", { value: Math.round(zoom * 100) })}</span>
        {error && <span className="v2-foot-item is-err">{t("widget.mermaid.error")}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}

/** Mermaid theme from the app's theme tokens (hex), so the diagram belongs to the window. */
function mermaidConfig() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => {
    const x = css.getPropertyValue(name).trim();
    return /^#[0-9a-f]{3,8}$/i.test(x) ? x : fallback;
  };
  const bg = v("--bg-elev", "#1A1722"), fg = v("--fg", "#F2EBE0"), accent = v("--accent", "#E8A24C"), accent2 = v("--accent2", "#C77DFF"), muted = v("--muted", "#908478");
  return {
    startOnLoad: false,
    theme: "base" as const,
    themeVariables: {
      background: "transparent", fontFamily: "IBM Plex Sans, system-ui, sans-serif", fontSize: "14px",
      primaryColor: bg, primaryTextColor: fg, primaryBorderColor: muted, lineColor: muted,
      secondaryColor: bg, tertiaryColor: bg, mainBkg: bg, nodeBorder: muted, clusterBkg: "transparent", clusterBorder: muted,
      edgeLabelBackground: "transparent", textColor: fg, titleColor: fg, noteBkgColor: bg, noteTextColor: fg, noteBorderColor: accent,
      actorBkg: bg, actorBorder: muted, actorTextColor: fg, signalColor: muted, signalTextColor: fg,
    },
    themeCSS: `.node polygon { stroke: ${accent2} !important; } .node rect, .node circle { rx: 10px; ry: 10px; } .flowchart-link { stroke-width: 1.5px; }`,
  };
}

/** Nodes and decisions of a flowchart, and the diagram's kind. */
export function diagramStats(src: string): { kind: string; nodes: number; decisions: number } {
  const first = src.trim().split(/\s+/)[0] ?? "";
  const ids = new Set<string>();
  const decisions = new Set<string>();
  if (/^(graph|flowchart)$/i.test(first)) {
    const re = /([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(|\[|\(|\{\{|\{|>)/g;
    for (const line of src.split("\n").slice(1)) {
      if (/^\s*(%%|classDef|class |style |linkStyle|subgraph|end\b|click )/.test(line)) continue;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(line))) { ids.add(m[1]); if (m[2] === "{") decisions.add(m[1]); }
    }
  }
  return { kind: first, nodes: ids.size, decisions: decisions.size };
}
