import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { ArtifactEvent } from "../lib/protocol";
import { parseContent } from "../components/widgets/base/DataWidget";
import { renderMarkdown } from "../lib/markdown";
import { installHtmlInCanvasPolyfill, getHtmlRenderer } from "three-html-render/polyfill";

// instala una vez (force true usa polyfill incluso si nativo existe — más estable en WebGL)
let polyfillInstalled = false;
function ensurePolyfill() {
  if (polyfillInstalled) return;
  try { installHtmlInCanvasPolyfill({ force: true } as never); polyfillInstalled = true; console.log("[HtmlTexturePanel] polyfill installed"); } catch (e) { console.warn("[HtmlTexturePanel] polyfill install fail", e); }
}

/**
 * Render fiel vía three-html-render (HTML-in-Canvas polyfill) — diseñado
 * para WebXR. Si falla, cae a html-to-image, y si también cuelga, a
 * fallback nativo (nunca queda cargando).
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
  const gl = useThree((s: unknown) => (s as { gl: THREE.WebGLRenderer }).gl);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const elRef = useRef<HTMLDivElement | null>(null);
  const canvasW = Math.round(widthMeters * pixelsPerMeter);
  const canvasH = Math.round(heightMeters * pixelsPerMeter);

  useEffect(() => {
    ensurePolyfill();
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      setFallback(false);
      setError(null);
      const canvasEl = gl.domElement as HTMLCanvasElement & { onpaint?: (()=>void)|null; requestPaint?: ()=>void; setAttribute?: (k:string,v:string)=>void; appendChild?: (n:Node)=>Node };
      if (!canvasEl) { setFallback(true); setError("sin canvas gl"); return; }

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
            try { const html = renderMarkdown(txt); return `<div style="padding:10px;color:#e2e8f0;font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;max-height:${canvasH - 30}px;overflow:hidden">${html.slice(0, 8000)}</div>`; } catch { const esc = txt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); return `<pre style="margin:0;padding:10px;font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;color:#e2e8f0;white-space:pre-wrap">${esc.slice(0, 4000)}</pre>`; }
          }
        } catch {}
        const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<pre style="margin:0;padding:10px;font-family:system-ui,sans-serif;font-size:12px;line-height:1.6;color:#e2e8f0;white-space:pre-wrap;word-break:break-word">${esc.slice(0, 4000) || "(vacío)"}</pre>`;
      })();
      const html = `<div style="width:${canvasW}px;min-height:${canvasH}px;background:${backgroundColor};overflow:hidden"><div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #1e293b;background:#111827;color:#38bdf8;font-size:13px;font-family:system-ui,sans-serif"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(ev.title || ev.windowType)} · ${ev.windowType}</span></div><div style="padding:0">${inner}</div></div>`;

      const el = document.createElement("div");
      el.innerHTML = html;
      el.style.width = canvasW + "px";
      el.style.minHeight = canvasH + "px";
      // three-html-render requiere layoutsubtree en el canvas padre
      try { (canvasEl as unknown as HTMLElement).setAttribute?.("layoutsubtree", "true"); } catch {}
      try { (canvasEl as unknown as HTMLElement).appendChild(el); } catch (e) { console.warn("append fail", e); }
      elRef.current = el;

      const waitPaint = () => new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done=true; try{ (canvasEl as unknown as {onpaint?:null}).onpaint=null;}catch{}; resolve(); };
        try { (canvasEl as unknown as {onpaint?:(()=>void)|null}).onpaint = finish; (canvasEl as unknown as {requestPaint?:()=>void}).requestPaint?.(); } catch {}
        setTimeout(finish, 800);
      });

      try {
        console.log("[HtmlTexturePanel] polyfill paint start", ev.id);
        await waitPaint();
        if (cancelled) return;
        const renderer = getHtmlRenderer();
        const snap: HTMLCanvasElement | null = renderer.getCanvas(el) as unknown as HTMLCanvasElement | null;
        if (!snap) throw new Error("getCanvas null");
        console.log("[HtmlTexturePanel] polyfill ok", snap.width, snap.height);
        const tex = new THREE.CanvasTexture(snap);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        // live updates
        try { (canvasEl as unknown as {onpaint:(()=>void)|null}).onpaint = () => { tex.needsUpdate = true; }; } catch {}
        cleanup = () => { try{ (canvasEl as unknown as {onpaint?:null}).onpaint=null; }catch{}; try{ el.remove(); }catch{}; tex.dispose(); };
        setTexture((prev)=>{ prev?.dispose(); return tex; });
        if (timeoutId) clearTimeout(timeoutId);
      } catch (e) {
        console.error("[HtmlTexturePanel] polyfill error", e);
        try{ el.remove(); }catch{}
        if (!cancelled) { setError(e instanceof Error ? e.message.slice(0,140) : String(e).slice(0,140)); setFallback(true); }
      }
    };

    timeoutId = setTimeout(() => {
      if (!cancelled && !texture) {
        console.warn("[HtmlTexturePanel] polyfill timeout → fallback", ev.id);
        setFallback(true);
        setError("raster timeout — fallback nativo");
        try{ elRef.current?.remove(); }catch{}
      }
    }, 3500);

    void run();
    return () => { cancelled = true; if (timeoutId) clearTimeout(timeoutId); if (cleanup) cleanup(); else try{ elRef.current?.remove(); }catch{}; };
  }, [ev, canvasW, canvasH, backgroundColor, gl]);

  useEffect(() => () => { texture?.dispose(); }, [texture]);

  if (fallback) {
    const lines = (ev.content ?? "(vacío)").replace(/<[^>]+>/g, " ").split("\n").filter((l) => l.trim()).slice(0, 14);
    return (
      <group>
        <mesh><planeGeometry args={[widthMeters, heightMeters]} /><meshBasicMaterial color="#0b0f14" side={THREE.DoubleSide} /></mesh>
        <Text position={[0, heightMeters/2 - 0.04, 0.013]} fontSize={0.018} color="#38bdf8" anchorX="center" anchorY="middle" maxWidth={widthMeters - 0.08}>{(ev.title || ev.windowType) + " · " + ev.windowType} — fallback</Text>
        {lines.map((l, i) => (
          <group key={i} position={[-widthMeters/2 + 0.06, heightMeters/2 - 0.12 - i * 0.038, 0.013]}>
            <Text fontSize={0.015} color="#e2e8f0" anchorX="left" anchorY="middle" maxWidth={widthMeters - 0.12}>{l.slice(0, 72) || " "}</Text>
          </group>
        ))}
        {error && <Text position={[0, -heightMeters/2 + 0.04, 0.013]} fontSize={0.011} color="#fb7185" anchorX="center" anchorY="middle" maxWidth={widthMeters - 0.08}>{error}</Text>}
      </group>
    );
  }
  if (!texture) {
    return (
      <group>
        <mesh><planeGeometry args={[widthMeters, heightMeters]} /><meshBasicMaterial color="#0b0f14" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
        <Text position={[0, 0, 0.013]} fontSize={0.016} color="#64748b" anchorX="center" anchorY="middle">cargando…</Text>
      </group>
    );
  }
  return (
    <mesh><planeGeometry args={[widthMeters, heightMeters]} /><primitive object={new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })} attach="material" /></mesh>
  );
}
