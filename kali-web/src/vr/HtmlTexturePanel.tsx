import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { Interactive } from "@react-three/xr";
import type { ArtifactEvent } from "../lib/protocol";
import { parseContent } from "../components/widgets/base/DataWidget";
import { renderMarkdown } from "../lib/markdown";

type Props = {
  ev: ArtifactEvent;
  widthMeters?: number;
  heightMeters?: number;
  pixelsPerMeter?: number;
  backgroundColor?: string;
};

/**
 * Soporte completo de WindowType en VR.
 * Cada tipo tiene renderer fiel en canvas 2D → CanvasTexture.
 * Interacción por tipo:
 *  - paginables (code/document/table/checklist/json/terminal/diff/quiz/reasoning): tap pagina
 *  - html: tap alterna código ↔ preview (split code+preview sería doble ancho; toggle es más legible en HMD)
 *  - chart/mermaid/qr/image/media: tap cicla detalle
 *  - ui3d no pasa por aquí (ScenePanel)
 */
export function HtmlTexturePanel({ ev, widthMeters = 0.86, heightMeters = 0.58, pixelsPerMeter = 700, backgroundColor = "#0b0f14" }: Props) {
  const canvasW = Math.round(widthMeters * pixelsPerMeter);
  const canvasH = Math.round(heightMeters * pixelsPerMeter);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"preview" | "code">("preview"); // solo html
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  const wt = ev.windowType as string;

  const { lines, isCode, title, isHtml } = useMemo(() => {
    const { data, title: t } = parseContent(ev);
    const raw = ev.content ?? "";
    const tt = t || ev.title || ev.windowType;
    // helpers
    const d = (typeof data === "object" && data ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
    if (wt === "table" || wt === "checklist") {
      const rows = (d.rows as Array<Record<string, unknown>> | undefined) || [];
      const items = (d.items as Array<{ text: string; done?: boolean }> | undefined) || [];
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const ls: string[] = [cols.join("  |  ")];
        rows.forEach((r) => ls.push(cols.map((c) => String(r[c] ?? "").slice(0, 18)).join("  |  ")));
        return { lines: ls.slice(0, 80), isCode: false, title: tt, isHtml: false };
      }
      if (items.length) return { lines: items.map((it) => `${it.done ? "☑" : "☐"} ${it.text}`).slice(0, 80), isCode: false, title: tt, isHtml: false };
    }
    if (wt === "code" || wt === "json" || wt === "terminal" || wt === "diff") {
      const code = typeof data === "string" ? data : (d.code ? String(d.code) : d.content ? String(d.content) : raw);
      return { lines: code.split("\n").slice(0, 100), isCode: true, title: tt, isHtml: false };
    }
    if (wt === "chart") {
      const rows = (d.rows as Array<Record<string, unknown>> | undefined) || (d.data as Array<Record<string, unknown>> | undefined) || [];
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const ls: string[] = [`chart · ${cols.join(", ")}`, ...rows.slice(0, 12).map((r) => cols.map((c) => `${c}:${String(r[c]).slice(0, 12)}`).join(" | "))];
        return { lines: ls, isCode: false, title: tt, isHtml: false };
      }
      return { lines: [JSON.stringify(d).slice(0, 200) || raw.slice(0, 200)], isCode: false, title: tt, isHtml: false };
    }
    if (wt === "mermaid") {
      const code = typeof data === "string" ? data : raw;
      return { lines: ["◈ mermaid diagram", "— ver preview en canvas 2D —", ...code.split("\n").slice(0, 40)], isCode: true, title: tt, isHtml: false };
    }
    if (wt === "qr" || wt === "link") {
      const url = typeof data === "string" ? data : (d.url as string) || (d.href as string) || raw;
      return { lines: [wt === "qr" ? "QR" : "LINK", url.slice(0, 80), ...(wt === "link" && d.title ? [String(d.title).slice(0, 80)] : [])], isCode: false, title: tt, isHtml: false };
    }
    if (wt === "image" || wt === "media") {
      const url = (d.url as string) || (d.src as string) || (d.image as string) || raw;
      return { lines: [wt.toUpperCase(), url.slice(0, 80), d.caption ? String(d.caption).slice(0, 80) : ""].filter(Boolean), isCode: false, title: tt, isHtml: false };
    }
    if (wt === "entity" || wt === "resource" || wt === "place") {
      const name = (d.name as string) || (d.title as string) || tt;
      const desc = (d.description as string) || (d.desc as string) || "";
      return { lines: [name, desc.slice(0, 80), ...Object.entries(d).slice(0, 6).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)], isCode: false, title: tt, isHtml: false };
    }
    if (wt === "quiz") {
      const qs = (d.questions as Array<{ q: string; options?: string[] }> | undefined) || (d.items as Array<{ q: string }> | undefined) || [];
      if (qs.length) return { lines: qs.flatMap((qq, i) => [`${i + 1}. ${(qq as { q: string }).q}`.slice(0, 80), ...(((qq as { options?: string[] }).options || []).map((o: string) => `  ○ ${o}`.slice(0, 80)))]).slice(0, 80), isCode: false, title: tt, isHtml: false };
    }
    if (wt === "controls" || wt === "widget") {
      return { lines: [wt, JSON.stringify(d).slice(0, 200) || raw.slice(0, 200)], isCode: false, title: tt, isHtml: false };
    }
    if (wt === "reasoning") {
      const txt = typeof data === "string" ? data : raw;
      return { lines: txt.split("\n").slice(0, 80), isCode: false, title: tt, isHtml: false };
    }
    if (wt === "game") {
      return { lines: ["GAME", JSON.stringify(d).slice(0, 200) || raw.slice(0, 200)], isCode: false, title: tt, isHtml: false };
    }
    // document/html/markdown/default
    const txt = typeof data === "string" ? data : (d.content ? String(d.content) : raw);
    const isHtmlRaw = txt.trim().startsWith("<") && txt.includes("</");
    if (wt === "html") {
      // para html guardamos ambos y el modo decide qué mostrar en el draw
      return { lines: isHtmlRaw ? [txt] : txt.split("\n").slice(0, 80), isCode: false, title: tt, isHtml: true };
    }
    if (isHtmlRaw) {
      const stripped = txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { lines: stripped.match(/.{1,72}(?:\s|$)/g)?.map((s) => s.trim()).slice(0, 80) || [stripped.slice(0, 72)], isCode: false, title: tt, isHtml: false };
    }
    try {
      const html = renderMarkdown(txt);
      const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { lines: stripped.match(/.{1,72}(?:\s|$)/g)?.map((s) => s.trim()).slice(0, 80) || [stripped.slice(0, 72)], isCode: false, title: tt, isHtml: false };
    } catch {
      return { lines: txt.split("\n").slice(0, 80), isCode: false, title: tt, isHtml: false };
    }
  }, [ev, wt]);

  const linesPerPage = wt === "html" && mode === "preview" ? 20 : 18;
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  const safePage = Math.min(page, pageCount - 1);
  const visible = useMemo(() => {
    if (wt === "html" && isHtml) {
      // html preview: en modo preview muestra HTML stripped paginado, en code muestra fuente
      if (mode === "code") {
        const raw = ev.content ?? "";
        const { data } = parseContent(ev);
        const code = typeof data === "string" ? data : (data as Record<string, unknown>)?.content ? String((data as Record<string, unknown>).content) : raw;
        return code.split("\n").slice(safePage * linesPerPage, (safePage + 1) * linesPerPage);
      }
      return lines.slice(safePage * linesPerPage, (safePage + 1) * linesPerPage);
    }
    return lines.slice(safePage * linesPerPage, (safePage + 1) * linesPerPage);
  }, [lines, safePage, linesPerPage, wt, isHtml, mode, ev]);

  useEffect(() => { setPage(0); setMode("preview"); }, [ev.id]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = canvasW / 600; // escala base 600px
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasW, canvasH);
    // header
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvasW, 28 * s);
    ctx.fillStyle = wt === "html" ? "#f59e0b" : wt === "chart" ? "#22d3ee" : wt === "mermaid" ? "#a78bfa" : wt === "qr" ? "#10b981" : wt === "image" || wt === "media" ? "#8b5cf6" : "#38bdf8";
    ctx.font = `600 ${13 * s}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const header = `${title} · ${wt}${pageCount > 1 ? `  ${safePage + 1}/${pageCount}` : ""}${wt === "html" ? `  [${mode}] tap↔` : ""}`;
    ctx.fillText(header.slice(0, 68), 10 * s, 14 * s);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 28 * s);
    ctx.lineTo(canvasW, 28 * s);
    ctx.stroke();

    // body
    const startY = 28 * s + 14 * s;
    const lineH = isCode || wt === "terminal" || wt === "diff" ? 13 * s : 15 * s;
    // tipo-specific bg
    if (wt === "terminal") {
      ctx.fillStyle = "#020617";
      ctx.fillRect(6 * s, 28 * s + 4 * s, canvasW - 12 * s, canvasH - 28 * s - 12 * s);
    }
    ctx.font = isCode || wt === "terminal" || wt === "diff" || wt === "mermaid"
      ? `${11 * s}px JetBrains Mono, monospace`
      : `${12 * s}px system-ui, sans-serif`;
    visible.forEach((l, i) => {
      const y = startY + i * lineH;
      if (y > canvasH - 12 * s) return;
      if (wt === "terminal") ctx.fillStyle = "#22c55e";
      else if (wt === "diff") ctx.fillStyle = l.startsWith("+") ? "#22c55e" : l.startsWith("-") ? "#fb7185" : "#e2e8f0";
      else if (isCode) ctx.fillStyle = "#c4b5fd";
      else if (l.startsWith("☑")) ctx.fillStyle = "#34d399";
      else if (l.startsWith("◈")) ctx.fillStyle = "#a78bfa";
      else if (l.startsWith("#")) ctx.fillStyle = "#7dd3fc";
      else ctx.fillStyle = "#e2e8f0";
      // para html preview, si es tag-like, atenúa
      const text = l.length > 88 ? l.slice(0, 85) + "…" : l;
      ctx.fillText(text, 10 * s, y);
    });

    // footer hint
    if (pageCount > 1 || wt === "html") {
      ctx.fillStyle = "#64748b";
      ctx.font = `${10 * s}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      const hint = wt === "html" ? "tap: código ↔ preview  •  hold grip para mover" : "tap para siguiente página  •  hold grip para mover";
      ctx.fillText(hint, canvasW / 2, canvasH - 8 * s);
      ctx.textAlign = "left";
    }
    // chart mini viz (barras) si es chart y hay datos numéricos
    if (wt === "chart" && visible.length > 1) {
      const barX = 10 * s, barY = canvasH - 60 * s, barW = canvasW - 20 * s, barH = 40 * s;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(barX, barY, barW, barH);
      const vals = visible.slice(1, 6).map((l) => {
        const m = l.match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : 0;
      });
      const max = Math.max(1, ...vals);
      vals.forEach((v, i) => {
        const w = barW / vals.length - 4 * s;
        const h = (v / max) * barH * 0.85;
        ctx.fillStyle = ["#38bdf8", "#a78bfa", "#fbbf24", "#34d399", "#f472b6"][i % 5];
        ctx.fillRect(barX + i * (barW / vals.length) + 2 * s, barY + barH - h, w, h);
      });
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    setTexture((prev) => { prev?.dispose(); return tex; });
    return () => { tex.dispose(); };
  }, [ev, visible, isCode, safePage, pageCount, canvasW, canvasH, backgroundColor, wt, title, mode]);

  const handleSelect = () => {
    if (wt === "html" && isHtml) {
      // alterna preview/code si es html; si tiene páginas, pagina dentro del modo
      if (pageCount > 1 && mode === "preview" && safePage < pageCount - 1) {
        setPage((p) => (p + 1) % pageCount);
      } else if (mode === "preview") {
        setMode("code");
        setPage(0);
      } else {
        setMode("preview");
        setPage(0);
      }
      return;
    }
    if (pageCount > 1) setPage((p) => (p + 1) % pageCount);
  };

  if (!texture) {
    return (
      <group>
        <mesh><planeGeometry args={[widthMeters, heightMeters]} /><meshBasicMaterial color="#0b0f14" transparent opacity={0.9} side={THREE.DoubleSide} /></mesh>
        <Text position={[0, 0, 0.013]} fontSize={0.016} color="#64748b" anchorX="center" anchorY="middle">cargando…</Text>
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
