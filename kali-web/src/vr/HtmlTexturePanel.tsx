import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { Interactive } from "@react-three/xr";
import type { ArtifactEvent } from "../lib/protocol";
import { parseContent } from "../components/widgets/base/DataWidget";
import { renderMarkdown } from "../lib/markdown";
import { toCanvas } from "html-to-image";

type Props = {
  ev: ArtifactEvent;
  widthMeters?: number;
  heightMeters?: number;
  pixelsPerMeter?: number;
  backgroundColor?: string;
};

/* helpers para escapar HTML */
function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* Construye HTML fiel por WindowType con estilos inline — lo que html-to-image rasteriza */
function buildHtml(ev: ArtifactEvent): { html: string; isCode: boolean } {
  const { data, title: t } = parseContent(ev);
  const raw = ev.content ?? "";
  const wt = ev.windowType as string;
  const d = (typeof data === "object" && data ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const title = t || ev.title || wt;

  // wrapper base
  const wrap = (inner: string, bg = "#0b0f14") =>
    `<div style=\"width:520px;min-height:340px;background:${bg};color:#e2e8f0;font-family:system-ui,sans-serif;padding:12px;box-sizing:border-box\">` +
    `<div style=\"font-size:11px;color:#94a3b8;margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px\">${esc(title)} · ${wt}</div>` +
    inner + `</div>`;

  if (wt === "table" || wt === "checklist") {
    const rows = (d.rows as Array<Record<string, unknown>> | undefined) || [];
    const items = (d.items as Array<{ text: string; done?: boolean }> | undefined) || [];
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const head = cols.map((c) => `<th style=\"text-align:left;padding:6px 8px;background:#1e293b;color:#38bdf8;font-size:12px\">${esc(c)}</th>`).join("");
      const body = rows.slice(0, 8).map((r, i) => `<tr style=\"background:${i%2 ? '#0f172a' : '#162032'}\"><td style=\"padding:6px 8px;border-top:1px solid #1e293b;font-size:12px\">${cols.map((c) => esc(String(r[c] ?? ""))).join('</td><td style=\"padding:6px 8px;border-top:1px solid #1e293b;font-size:12px\">')}</td></tr>`).join("");
      return { html: wrap(`<table style=\"width:100%;border-collapse:collapse\"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`), isCode: false };
    }
    if (items.length) {
      const lis = items.slice(0, 10).map((it) => `<div style=\"display:flex;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid #1e293b;font-size:13px\"><span style=\"width:16px;height:16px;border:1px solid ${it.done?"#22c55e":"#475569"};background:${it.done?"#22c55e":"transparent"};display:inline-flex;align-items:center;justify-content:center;color:#022c22;font-size:11px\">${it.done?"✓":""}</span><span style=\"${it.done?"text-decoration:line-through;color:#64748b":""}\">${esc(it.text)}</span></div>`).join("");
      return { html: wrap(lis), isCode: false };
    }
  }
  if (wt === "code" || wt === "json" || wt === "terminal" || wt === "diff" || wt === "mermaid") {
    const code = typeof data === "string" ? data : (d.code ? String(d.code) : d.content ? String(d.content) : raw);
    const bg = wt === "terminal" ? "#020617" : "#0f172a";
    const color = wt === "terminal" ? "#22c55e" : wt === "diff" ? "#e2e8f0" : "#cbd5e1";
    const inner = `<pre style=\"margin:0;white-space:pre-wrap;word-break:break-word;font-family:JetBrains Mono,monospace;font-size:11px;line-height:1.5;color:${color};background:${bg};padding:10px;border-radius:6px\">${esc(code.slice(0, 2000))}</pre>`;
    if (wt === "mermaid") {
      const note = `<div style=\"margin-top:8px;font-size:11px;color:#a78bfa\">◈ mermaid — preview en canvas 2D es SVG; aquí se muestra fuente</div>`;
      return { html: wrap(inner + note, bg), isCode: true };
    }
    return { html: wrap(inner, bg), isCode: true };
  }
  if (wt === "chart") {
    const rows = (d.rows as Array<Record<string, unknown>> | undefined) || (d.data as Array<Record<string, unknown>> | undefined) || [];
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const max = Math.max(1, ...rows.map((r) => { const v = Object.values(r).find((x) => typeof x === "number") as number | undefined; return typeof v === "number" ? v : parseFloat(String(Object.values(r)[1] ?? 0)) || 0; }));
      const bars = rows.slice(0, 5).map((r, i) => {
        const fv = parseFloat(String((Object.values(r)[1] ?? 0) as string)) || 0;
        const v = ((Object.values(r).find((x) => typeof x === "number") as number | undefined) ?? fv);
        const w = Math.round((v / max) * 100);
        const col = ["#38bdf8","#a78bfa","#fbbf24","#34d399","#f472b6"][i%5];
        return `<div style=\"display:flex;align-items:center;gap:8px;margin:6px 0\"><span style=\"width:44px;font-size:11px;color:#94a3b8\">${esc(String(Object.values(r)[0] ?? i))}</span><div style=\"flex:1;height:16px;background:#1e293b;border-radius:4px;overflow:hidden\"><div style=\"width:${w}%;height:100%;background:${col}\"></div></div><span style=\"width:36px;text-align:right;font-size:11px;color:#e2e8f0\">${v}</span></div>`;
      }).join("");
      const table = `<div style=\"margin-top:10px\">${bars}</div>`;
      return { html: wrap(`<div style=\"font-size:11px;color:#94a3b8\">${esc(cols.join(" · "))}</div>` + table), isCode: false };
    }
  }
  if (wt === "qr" || wt === "link") {
    const url = typeof data === "string" ? data : (d.url as string) || (d.href as string) || raw;
    const inner = `<div style=\"text-align:center;padding:20px\"><div style=\"display:inline-block;padding:12px;background:#fff;border-radius:8px\"><div style=\"width:120px;height:120px;background:repeating-linear-gradient(0deg,#000 0 4px,#fff 4px 8px);border:2px solid #000;display:flex;align-items:center;justify-content:center;font-size:28px\">◈</div></div><div style=\"margin-top:12px;font-size:13px;word-break:break-all;color:#38bdf8\">${esc(url.slice(0, 80))}</div>${wt==="link" && d.title ? `<div style=\"margin-top:6px;font-size:12px;color:#e2e8f0\">${esc(String(d.title).slice(0, 80))}</div>` : ""}</div>`;
    return { html: wrap(inner, "#0b0f14"), isCode: false };
  }
  if (wt === "image" || wt === "media") {
    const url = (d.url as string) || (d.src as string) || (d.image as string) || raw;
    const inner = `<div style=\"text-align:center;padding:12px\"><div style=\"width:100%;height:180px;background:#1e293b;border:1px solid #334155;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px\">[imagen] ${esc(url.slice(0, 44))}</div><div style=\"margin-top:8px;font-size:11px;color:#94a3b8;word-break:break-all\">${esc(url.slice(0, 70))}</div>${d.caption ? `<div style=\"margin-top:4px;font-size:12px;color:#e2e8f0\">${esc(String(d.caption).slice(0, 80))}</div>` : ""}</div>`;
    return { html: wrap(inner), isCode: false };
  }
  if (wt === "entity" || wt === "resource" || wt === "place") {
    const name = (d.name as string) || (d.title as string) || title;
    const desc = (d.description as string) || (d.desc as string) || "";
    const rows = Object.entries(d).filter(([k]) => !["name","title","description","desc"].includes(k)).slice(0, 6).map(([k,v]) => `<div style=\"display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e293b;font-size:11px\"><span style=\"color:#94a3b8\">${esc(k)}</span><span style=\"color:#e2e8f0\">${esc(String(v).slice(0, 40))}</span></div>`).join("");
    const inner = `<div style=\"padding:8px;background:#1e293b;border-radius:8px\"><div style=\"font-size:16px;font-weight:700;color:#38bdf8\">${esc(name)}</div><div style=\"margin-top:6px;font-size:12px;color:#cbd5e1\">${esc(desc.slice(0, 120))}</div><div style=\"margin-top:10px\">${rows}</div></div>`;
    return { html: wrap(inner), isCode: false };
  }
  if (wt === "quiz") {
    const qs = (d.questions as Array<{ q: string; options?: string[] }> | undefined) || [];
    if (qs.length) {
      const lis = qs.slice(0, 3).map((qq, i) => `<div style=\"margin:8px 0;padding:10px;background:#1e293b;border-radius:6px\"><div style=\"font-size:12px;font-weight:600;color:#e2e8f0\">${i+1}. ${esc((qq as { q: string }).q)}</div><div style=\"margin-top:6px\">${(((qq as { options?: string[] }).options || []).map((o) => `<div style=\"display:flex;gap:8px;align-items:center;padding:4px 6px;margin:3px 0;background:#0f172a;border-radius:4px;font-size:12px\"><span style=\"width:14px;height:14px;border:1px solid #475569;border-radius:50%;display:inline-block\"></span>${esc(o)}</div>`).join(""))}</div></div>`).join("");
      return { html: wrap(lis), isCode: false };
    }
  }
  if (wt === "reasoning" || wt === "document" || wt === "widget" || wt === "controls" || wt === "game") {
    const txt = typeof data === "string" ? data : (d.content ? String(d.content) : raw);
    try {
      const htmlMd = renderMarkdown(txt);
      return { html: wrap(`<div style=\"font-size:12px;line-height:1.6;color:#e2e8f0\">${htmlMd}</div>`), isCode: false };
    } catch {
      return { html: wrap(`<pre style=\"white-space:pre-wrap;font-size:11px;color:#e2e8f0\">${esc(txt.slice(0, 1500))}</pre>`), isCode: false };
    }
  }
  // html — preview real (raw HTML inyectado tal cual), con fallback a stripped si falla
  if (wt === "html") {
    const txt = typeof data === "string" ? data : (d.content ? String(d.content) : raw);
    const isHtmlRaw = txt.trim().startsWith("<") && txt.includes("</");
    if (isHtmlRaw) {
      // preview: HTML vivo con marco
      return { html: `<div style=\"width:520px;background:#fff;color:#111;padding:0;overflow:hidden\"><div style=\"font-size:10px;color:#64748b;padding:6px 10px;border-bottom:1px solid #e2e8f0;background:#f8fafc\">${esc(title)} · html — preview</div><div style=\"padding:10px\">${txt}</div></div>`, isCode: false };
    }
    return { html: wrap(`<pre style=\"white-space:pre-wrap;font-size:11px\">${esc(txt.slice(0, 1500))}</pre>`), isCode: false };
  }
  // default: markdown
  const txt2 = typeof data === "string" ? data : (d.content ? String(d.content) : raw);
  const isHtmlRaw = txt2.trim().startsWith("<") && txt2.includes("</");
  if (isHtmlRaw) {
    const stripped = txt2.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const wrapped = stripped.match(/.{1,80}(?:\s|$)/g)?.join("<br/>") || esc(stripped.slice(0, 500));
    return { html: wrap(`<div style=\"font-size:12px;line-height:1.6\">${wrapped}</div>`), isCode: false };
  }
  try {
    const htmlMd = renderMarkdown(txt2);
    return { html: wrap(`<div style=\"font-size:12px;line-height:1.6\">${htmlMd}</div>`), isCode: false };
  } catch {
    return { html: wrap(`<pre style=\"white-space:pre-wrap;font-size:11px\">${esc(txt2.slice(0, 1500))}</pre>`), isCode: false };
  }
}

export function HtmlTexturePanel({ ev, widthMeters = 0.86, heightMeters = 0.58, pixelsPerMeter = 700, backgroundColor = "#0b0f14" }: Props) {
  const canvasW = Math.round(widthMeters * pixelsPerMeter);
  const canvasH = Math.round(heightMeters * pixelsPerMeter);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [failed, setFailed] = useState(false);
  const wt = ev.windowType as string;
  const isHtmlReal = wt === "html" && (ev.content ?? "").trim().startsWith("<");

  const built = useMemo(() => buildHtml(ev), [ev]);

  // para html con toggle código: en modo code mostramos fuente real
  const htmlToRaster = useMemo(() => {
    if (isHtmlReal && mode === "code") {
      const raw = ev.content ?? "";
      return `<div style=\"width:520px;min-height:340px;background:#0f172a;color:#cbd5e1;font-family:JetBrains Mono,monospace;padding:12px;box-sizing:border-box\"><div style=\"font-size:11px;color:#94a3b8;margin-bottom:8px;border-bottom:1px solid #1e293b;padding-bottom:6px\">${esc(ev.title || "html")} · html — código</div><pre style=\"margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.5\">${esc(raw.slice(0, 2000))}</pre></div>`;
    }
    return built.html;
  }, [built.html, isHtmlReal, mode, ev.content, ev.title]);

  useEffect(() => { setPage(0); setMode("preview"); setFailed(false); }, [ev.id]);
  useEffect(() => { setFailed(false); }, [mode, page]);

  // paginación: si el HTML rasterizado es muy alto, html-to-image lo captura entero; paginamos via scroll offset en el div
  const pageCount = 1; // raster completo; paginación se haría scrolleando el div si hiciera falta — por ahora 1 página fiel
  const safePage = 0;

  useEffect(() => {
    let cancelled = false;
    let host: HTMLDivElement | null = null;
    let tex: THREE.CanvasTexture | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const makeFallback = () => {
      if (cancelled || tex) return;
      console.warn("[HtmlTexturePanel] fallback forzado canvas2D");
      setFailed(true);
      const out = document.createElement("canvas");
      out.width = canvasW;
      out.height = canvasH;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      const s = canvasW / 600;
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, canvasW, 28 * s);
      ctx.fillStyle = "#f59e0b";
      ctx.font = `600 ${12 * s}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(`${ev.title || wt} · ${wt} — fallback`, 10 * s, 14 * s);
      ctx.font = `${11 * s}px system-ui, sans-serif`;
      ctx.fillStyle = "#e2e8f0";
      const tmp = document.createElement("div");
      tmp.innerHTML = htmlToRaster;
      const txt = (tmp.textContent || tmp.innerText || ev.content || "").replace(/\s+/g, " ").trim();
      const lines = txt.match(/.{1,68}(?:\s|$)/g)?.slice(0, 20) || [txt.slice(0, 68)];
      lines.forEach((l, i) => ctx.fillText(l.trim().slice(0, 74), 10 * s, 36 * s + i * 14 * s));
      if (!cancelled) { tex = new THREE.CanvasTexture(out); tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; setTexture(tex); }
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
    };

    fallbackTimer = setTimeout(makeFallback, 900);

    const run = async () => {
      // 1) crear host offscreen
      host = document.createElement("div");
      host.style.position = "fixed";
      host.style.left = "-10000px";
      host.style.top = "0";
      host.style.width = "520px";
      host.style.background = "#0b0f14";
      host.style.overflow = "hidden";
      host.innerHTML = htmlToRaster;
      if (page > 0) {
        host.firstElementChild && ((host.firstElementChild as HTMLElement).style.transform = `translateY(-${page * 300}px)`);
      }
      document.body.appendChild(host);
      await new Promise((r) => setTimeout(r, 50));

      if (cancelled) return;
      try {
        const canvas = await Promise.race([
          toCanvas(host, { pixelRatio: 1, cacheBust: true, width: 520, height: Math.min(420, host.scrollHeight || 360) }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("raster timeout")), 2200)),
        ]);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (cancelled) return;
        // escalar al tamaño de textura VR
        const out = document.createElement("canvas");
        out.width = canvasW;
        out.height = canvasH;
        const ctx = out.getContext("2d");
        if (!ctx) throw new Error("no ctx");
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvasW, canvasH);
        // centrar canvas rasterizado (cover contain)
        const scale = Math.min(canvasW / canvas.width, canvasH / canvas.width) * 0.96;
        // dibuja centrado arriba
        const dw = canvas.width * scale;
        const dh = canvas.height * scale;
        const dx = (canvasW - dw) / 2;
        const dy = 8;
        ctx.drawImage(canvas, dx, dy, dw, Math.min(dh, canvasH - 16));
        // footer hint
        if (isHtmlReal) {
          ctx.fillStyle = "#64748b";
          ctx.font = `${10 * (canvasW / 600)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(mode === "preview" ? "tap: ver código · grip: mover" : "tap: ver preview · grip: mover", canvasW / 2, canvasH - 8);
          ctx.textAlign = "left";
        }
        tex = new THREE.CanvasTexture(out);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        if (!cancelled) { setTexture(tex); setFailed(false); }
      } catch (e) {
        console.warn("[HtmlTexturePanel] raster fallo, fallback canvas2D", e);
        if (cancelled) return;
        setFailed(true);
        // fallback: canvas2D texto rico (no plain)
        const out = document.createElement("canvas");
        out.width = canvasW;
        out.height = canvasH;
        const ctx = out.getContext("2d");
        if (!ctx) return;
        const s = canvasW / 600;
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvasW, canvasH);
        ctx.fillStyle = "#111827";
        ctx.fillRect(0, 0, canvasW, 28 * s);
        ctx.fillStyle = "#38bdf8";
        ctx.font = `600 ${13 * s}px system-ui, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(`${ev.title || wt} · ${wt} — fallback`, 10 * s, 14 * s);
        ctx.font = `${12 * s}px system-ui, sans-serif`;
        ctx.fillStyle = "#e2e8f0";
        const lines = (ev.content ?? "").split("\n").slice(0, 22);
        lines.forEach((l, i) => ctx.fillText(l.slice(0, 78), 10 * s, 36 * s + i * 15 * s));
        tex = new THREE.CanvasTexture(out);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        if (!cancelled) setTexture(tex);
      } finally {
        if (host && host.parentNode) host.parentNode.removeChild(host);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (host && host.parentNode) host.parentNode.removeChild(host);
      tex?.dispose();
    };
  }, [htmlToRaster, canvasW, canvasH, backgroundColor, wt, ev.title, mode, safePage, page, isHtmlReal]);

  const handleSelect = () => {
    if (isHtmlReal) {
      setMode((m) => (m === "preview" ? "code" : "preview"));
      return;
    }
    if (pageCount > 1) setPage((p) => (p + 1) % pageCount);
  };

  if (!texture) {
    return (
      <group>
        <mesh><planeGeometry args={[widthMeters, heightMeters]} /><meshBasicMaterial color="#0b0f14" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
        <Text position={[0, 0, 0.013]} fontSize={0.016} color="#64748b" anchorX="center" anchorY="middle">{failed ? "render fallback…" : "rasterizando…"}</Text>
      </group>
    );
  }

  return (
    <Interactive onSelect={handleSelect}>
      <mesh>
        <planeGeometry args={[widthMeters, heightMeters]} />
        <primitive object={new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })} attach="material" />
      </mesh>
    </Interactive>
  );
}
