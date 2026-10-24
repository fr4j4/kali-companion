/**
 * ImageWidget — a picture viewer: the image fitted to the window on a quiet backdrop, zoom from
 * the corner (or the wheel, double click to fit), drag to look around when zoomed, and the name
 * and size in the footer. Opening it in a browser tab is in the header.
 */

import { useState, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Image as ImageIcon, Minus, Plus, Maximize } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";
import { parseContent } from "./base/DataWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShell, useShellSample, useShellSubtitle } from "../../stage/v2/shell";

interface Props {
  content?: unknown;
}

export function imageUrlOf(d: unknown): string | null {
  if (typeof d === "string") return d;
  const o = (d ?? {}) as Record<string, unknown>;
  if (typeof o.url === "string" && o.url) return o.url;
  if (typeof o.path === "string" && o.path) {
    // Absolute path → served by the /file endpoint (reads from disk).
    if (o.path.startsWith("/")) return `/file?path=${encodeURIComponent(o.path)}`;
    // Relative path under a known static mount.
    if (o.path.startsWith("snapshots/")) return `/${o.path}`;
    return `/images/${o.path}`;
  }
  return null;
}

export function ImageWidget({ content }: Props) {
  const { t } = useTranslation();
  const { compact } = useShell();
  const { data, isReal } = useMemo(() => parseContent(content), [content]);
  const d = (data ?? {}) as Record<string, unknown>;
  const imgUrl = useMemo(() => imageUrlOf(data), [data]);
  const name = (typeof d === "object" && ((d.name as string) || (d.title as string))) || t("widget.image.fallback");
  const caption = typeof d === "object" && typeof d.caption === "string" ? d.caption : "";

  const [zoom, setZoom] = useState<number | null>(null); // null = fit
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const fitScale = useCallback(() => {
    const el = stageRef.current;
    if (!el || !natural) return 1;
    return Math.min(1, (el.clientWidth - 32) / natural.w, (el.clientHeight - 32) / natural.h);
  }, [natural]);
  const scale = zoom ?? fitScale();
  const setScale = (z: number) => { setZoom(Math.max(0.1, Math.min(8, z))); };
  const fit = () => { setZoom(null); setPan({ x: 0, y: 0 }); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || zoom == null) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    const move = (ev: PointerEvent) => setPan({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", () => target.removeEventListener("pointermove", move), { once: true });
  };

  const actions: HeaderAction[] = useMemo(() => (imgUrl ? [
    { type: "custom", icon: <ExternalLink size={14} />, onClick: () => window.open(imgUrl, "_blank", "noopener"), tip: t("widget.image.open") },
  ] : []), [imgUrl, t]);
  const { rendered: headerActions } = useHeaderActions(actions);

  useShellSubtitle(natural ? `${natural.w} × ${natural.h}` : name);
  useShellSample(!isReal);

  return (
    <BaseWidget>
      <WidgetToolbar>{headerActions}</WidgetToolbar>
      <div
        ref={stageRef}
        className={`kw-viewer ${zoom != null ? "is-zoomed" : ""}`}
        onWheel={(e) => { if (natural) setScale(scale * (e.deltaY < 0 ? 1.1 : 0.9)); }}
        onDoubleClick={() => (zoom == null ? setScale(1) : fit())}
        onPointerDown={onPointerDown}
      >
        {imgUrl && !failed ? (
          <img
            src={imgUrl}
            alt={caption || name}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            style={natural ? { width: natural.w * scale, height: natural.h * scale, transform: `translate(${pan.x}px, ${pan.y}px)` } : { maxWidth: "100%", maxHeight: "100%" }}
          />
        ) : (
          <div className="kw-empty-state">
            <span className="kw-empty-icon"><ImageIcon size={22} aria-hidden="true" /></span>
            <p>{failed ? t("v2.image.failed") : t("v2.image.none")}</p>
          </div>
        )}
        {natural && !compact && (
          <div className="kw-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setScale(scale / 1.25)} aria-label={t("v2.zoom.out") as string}><Minus size={14} /></button>
            <span className="kw-mono">{Math.round(scale * 100)} %</span>
            <button type="button" onClick={() => setScale(scale * 1.25)} aria-label={t("v2.zoom.in") as string}><Plus size={14} /></button>
            <button type="button" onClick={fit} aria-label={t("v2.zoom.fit") as string} title={t("v2.zoom.fit") as string}><Maximize size={14} /></button>
          </div>
        )}
      </div>
      {caption && !compact && <p className="kw-caption">{caption}</p>}
      <WidgetFooter>
        <span className="v2-foot-item">{name}</span>
        {natural && <span className="v2-foot-item kw-mono">{natural.w} × {natural.h}</span>}
        {natural && <span className="v2-foot-item">{t("v2.diagram.zoom", { value: Math.round(scale * 100) })}</span>}
      </WidgetFooter>
    </BaseWidget>
  );
}
