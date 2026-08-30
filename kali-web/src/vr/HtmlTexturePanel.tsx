import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { toCanvas } from "html-to-image";
import type { ArtifactEvent } from "../lib/protocol";
import { parseContent } from "../components/widgets/base/DataWidget";
import { renderMarkdown } from "../lib/markdown";
import { Text } from "@react-three/drei";

/**
 * HtmlTexturePanel — intenta raster fiel vía html-to-image.
 * Si toCanvas cuelga/timeout (Quest), cae a fallback nativo 3D garantizado
 * (nunca queda en "cargando…").
 */
export function HtmlTexturePanel({
  ev,
  widthMeters = 0.86,
  heightMeters = 0.58,
  pixelsPerMeter = 620,
  backgroundColor = "#0b0f14",
}: {
  ev: ArtifactEvent;
  widthMeters?: number;
  heightMeters?: number;
  pixelsPerMeter?: number;
  backgroundColor?: string;
}) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);
  const canvasW = Math.round(widthMeters * pixelsPerMeter);
  const canvasH = Math.round(heightMeters * pixelsPerMeter);

  useEffect(() => {
    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.left = "-9999px";
    div.style.top = "-9999px";
    div.style.width = `${canvasW}px`;
    div.style.height = `${canvasH}px`;
    div.style.overflow = "hidden";
    div.style.backgroundColor = backgroundColor;
    div.style.pointerEvents = "none";
    document.body.appendChild(div);
    containerRef.current = div;
    rootRef.current = createRoot(div);
    return () => {
      try { rootRef.current?.unmount(); } catch {}
      if (div.parentNode) div.parentNode.removeChild(div);
      containerRef.current = null;
      rootRef.current = null;
    };
  }, [canvasW, canvasH, backgroundColor]);

  useEffect(() => {
    let cancelled = false;
    const div = containerRef.current;
    const root = rootRef.current;
    if (!div || !root) return;
    setFallback(false);
    setError(null);
    const { data } = parseContent(ev);
    const raw = ev.content ?? "";
    const inner = (() => {
      try {
        if (ev.windowType === "table" || ev.windowType === "checklist") {
          const d = typeof data === "object" && data ? (data as Record<string, unknown>) : {};
          const rows = (d.rows as Array<Record<string, unknown>> | undefined) || [];
          const items = (d.items as Array<{ text: string; done?: boolean }> | undefined) || [];
          if (rows.length) {
            const cols = Object.keys(rows[0]);
            return `<table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:11px;color:#e2e8f0"><thead><tr>${cols.map((c) => `<th style="text-align:left;padding:6px 8px;border-bottom:1px solid #1e293b;color:#7dd3fc">${c}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 12).map((r) => `<tr>${cols.map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #0f172a">${String(r[c] ?? "").slice(0, 30)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
          }
          if (items.length) return `<div style="font-family:system-ui,sans-serif;font-size:12px;color:#e2e8f0">${items.slice(0, 12).map((it) => `<div style="padding:4px 0;display:flex;gap:8px"><span style="color:${it.done ? "#34d399" : "#475569"}">${it.done ? "☑" : "☐"}</span><span>${it.text}</span></div>`).join("")}</div>`;
        }
        if (ev.windowType === "code" || ev.windowType === "json") {
          const code = typeof data === "string" ? data : (data as Record<string, unknown>)?.code ? String((data as Record<string, unknown>).code) : raw;
          const esc = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          return `<pre style="margin:0;padding:10px;font-family:monospace;font-size:11px;line-height:1.5;color:#c4b5fd;white-space:pre-wrap;word-break:break-word">${esc.slice(0, 4000)}</pre>`;
        }
        if (ev.windowType === "document" || ev.windowType === "html" || ev.windowType === "markdown") {
          const txt = typeof data === "string" ? data : (data as Record<string, unknown>)?.content ? String((data as Record<string, unknown>).content) : raw;
          if (txt.trim().startsWith("<") && txt.includes("</")) return `<div style="padding:8px;color:#e2e8f0;font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;max-height:${canvasH - 30}px;overflow:hidden">${txt.slice(0, 6000)}</div>`;
          try {
            const html = renderMarkdown(txt);
            return `<div style="padding:10px;color:#e2e8f0;font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;max-height:${canvasH - 30}px;overflow:hidden">${html.slice(0, 8000)}</div>`;
          } catch {
            const esc = txt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<pre style="margin:0;padding:10px;font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;color:#e2e8f0;white-space:pre-wrap">${esc.slice(0, 4000)}</pre>`;
          }
        }
      } catch {}
      const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<pre style="margin:0;padding:10px;font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;color:#e2e8f0;white-space:pre-wrap;word-break:break-word">${esc.slice(0, 4000) || "(vacío)"}</pre>`;
    })();
    const html = `<div style="width:${canvasW}px;min-height:${canvasH}px;background:${backgroundColor};overflow:hidden"><div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #1e293b;background:#111827;color:#38bdf8;font-size:13px;font-family:system-ui,sans-serif"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(ev.title || ev.windowType)} · ${ev.windowType}</span></div><div style="padding:0">${inner}</div></div>`;
    flushSync(() => { root.render(<div dangerouslySetInnerHTML={{ __html: html }} />); });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const doCapture = async () => {
      for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 16)); if ((div.firstChild as HTMLElement | null)?.offsetHeight) break; }
      await new Promise((r) => setTimeout(r, 60));
      const target = div.firstChild as HTMLElement | null;
      if (!target) { if (!cancelled) setError("sin target"); return; }
      try {
        console.log("[HtmlTexturePanel] toCanvas start", ev.id);
        const canvas = await Promise.race([
          toCanvas(target as HTMLElement, { cacheBust: false, pixelRatio: 1.5, backgroundColor, skipFonts: true } as never),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("toCanvas timeout 2500ms")), 2500)),
        ]);
        console.log("[HtmlTexturePanel] toCanvas ok", (canvas as HTMLCanvasElement).width);
        if (cancelled) return;
        const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        setTexture((prev) => { prev?.dispose(); return tex; });
        setError(null);
        if (timeoutId) clearTimeout(timeoutId);
      } catch (e) {
        console.error("[HtmlTexturePanel] toCanvas error", e);
        if (!cancelled) { setError(e instanceof Error ? e.message.slice(0, 140) : String(e).slice(0, 140)); setFallback(true); }
      }
    };
    void doCapture();
    timeoutId = setTimeout(() => {
      if (!cancelled && !texture) {
        console.warn("[HtmlTexturePanel] timeout sin textura → fallback nativo", ev.id);
        setFallback(true);
        setError("raster lento — fallback nativo");
      }
    }, 3000);
    return () => { cancelled = true; if (timeoutId) clearTimeout(timeoutId); };
  }, [ev, canvasW, canvasH, backgroundColor]);

  useEffect(() => () => { texture?.dispose(); }, [texture]);

  // Fallback nativo garantizado: nunca deja en "cargando…" eterno
  if (fallback) {
    const lines = (ev.content ?? "(vacío)").replace(/<[^>]+>/g, " ").split("\n").filter((l) => l.trim()).slice(0, 14);
    return (
      <group>
        <mesh><planeGeometry args={[widthMeters, heightMeters]} /><meshBasicMaterial color="#0b0f14" side={THREE.DoubleSide} /></mesh>
        <Text position={[0, heightMeters/2 - 0.04, 0.012]} fontSize={0.018} color="#38bdf8" anchorX="center" anchorY="middle" maxWidth={widthMeters - 0.08}>{(ev.title || ev.windowType) + " · " + ev.windowType} — fallback</Text>
        {lines.map((l, i) => (
          <group key={i} position={[-widthMeters/2 + 0.06, heightMeters/2 - 0.10 - i * 0.04, 0.012]}>
            <Text fontSize={0.016} color="#e2e8f0" anchorX="left" anchorY="middle" maxWidth={widthMeters - 0.12}>{l.slice(0, 70) || " "}</Text>
          </group>
        ))}
        {error && <Text position={[0, -heightMeters/2 + 0.04, 0.012]} fontSize={0.012} color="#fb7185" anchorX="center" anchorY="middle" maxWidth={widthMeters - 0.08}>{error}</Text>}
      </group>
    );
  }

  if (error && !texture) {
    return (
      <group>
        <mesh><planeGeometry args={[widthMeters, heightMeters]} /><meshBasicMaterial color="#0b0f14" side={THREE.DoubleSide} /></mesh>
        <Text position={[0, 0, 0.012]} fontSize={0.016} color="#fb7185" anchorX="center" anchorY="middle" maxWidth={widthMeters - 0.08}>{error}</Text>
      </group>
    );
  }
  if (!texture) {
    return (
      <group>
        <mesh><planeGeometry args={[widthMeters, heightMeters]} /><meshBasicMaterial color="#0b0f14" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
        <Text position={[0, 0, 0.012]} fontSize={0.016} color="#64748b" anchorX="center" anchorY="middle">cargando…</Text>
      </group>
    );
  }
  return (
    <mesh><planeGeometry args={[widthMeters, heightMeters]} /><primitive object={new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })} attach="material" /></mesh>
  );
}
