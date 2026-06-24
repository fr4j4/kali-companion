import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BaseWidget } from "./base/BaseWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { SAMPLE_MERMAID } from "./utils/sampleData";
import { parseContent } from "./base/DataWidget";

interface Props {
  content?: unknown;
}

export function MermaidWidget({ content }: Props) {
  const { t } = useTranslation();
  const { data } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const source = useMemo(() => {
    if (typeof d === "string") return d;
    if (d.source && typeof d.source === "string") return d.source;
    return SAMPLE_MERMAID;
  }, [d]);

  const svgRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      const mermaid = (window as any).mermaid;
      if (!mermaid) { setError(true); return; }
      mermaid.initialize({ startOnLoad: false, theme: "dark" });
      mermaid.render("mermaid-svg", source).then((r: any) => {
        if (svgRef.current) svgRef.current.innerHTML = r.svg;
      }).catch(() => setError(true));
    } catch {
      setError(true);
    }
  }, [source]);

  const actions: HeaderAction[] = useMemo(() => [
    { type: "copy", getContent: () => source, tip: t("widget.mermaid.copy_source") },
    { type: "download", content: source, filename: "diagram.mmd", tip: t("widget.mermaid.download") },
  ], [source]);

  const { rendered: headerActions } = useHeaderActions(actions);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
  };

  useEffect(() => {
    return () => {
      // Cleanup any stray pointer listeners on unmount.
      window.removeEventListener("pointermove", () => {});
      window.removeEventListener("pointerup", () => {});
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    let active = true;
    const onMove = (ev: PointerEvent) => {
      if (active) setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    };
    const onUp = () => {
      active = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <BaseWidget>
      {headerActions.length > 0 && (
        <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-white/5 shrink-0">
          {headerActions}
        </div>
      )}
      <div
        className="mermaid-container flex-1"
        ref={svgRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        style={{ cursor: "grab", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {error && <p className="text-xs text-muted">{t("widget.mermaid.error")}</p>}
      </div>
    </BaseWidget>
  );
}
