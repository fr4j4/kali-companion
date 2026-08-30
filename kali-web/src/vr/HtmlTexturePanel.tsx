import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { Interactive } from "@react-three/xr";
import type { ArtifactEvent } from "../lib/protocol";
import { parseContent } from "../components/widgets/base/DataWidget";
import { renderMarkdown } from "../lib/markdown";

/**
 * HtmlTexturePanel — render fiel vía Canvas 2D (no html-to-image, no polyfill).
 * Dibuja header + contenido tipado directamente en <canvas> → CanvasTexture.
 * 100% fiable en Quest, sin timeouts, y deja locomotion/botones intactos.
 * Interactuable: tap (trigger) pagina el contenido si es largo.
 */
export function HtmlTexturePanel({
  ev,
  widthMeters = 0.86,
  heightMeters = 0.58,
  pixelsPerMeter = 700,
  backgroundColor = "#0b0f14",
}: {
  ev: ArtifactEvent;
  widthMeters?: number;
  heightMeters?: number;
  pixelsPerMeter?: number;
  backgroundColor?: string;
}) {
  const canvasW = Math.round(widthMeters * pixelsPerMeter);
  const canvasH = Math.round(heightMeters * pixelsPerMeter);
  const [page, setPage] = useState(0);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  const { lines, isCode } = useMemo(() => {
    const { data } = parseContent(ev);
    const raw = ev.content ?? "";
    if (ev.windowType === "table" || ev.windowType === "checklist") {
      const d = typeof data === "object" && data ? (data as Record<string, unknown>) : {};
      const rows = (d.rows as Array<Record<string, unknown>> | undefined) || [];
      const items = (d.items as Array<{ text: string; done?: boolean }> | undefined) || [];
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const header = cols.join("  |  ");
        const body = rows.map((r) => cols.map((c) => String(r[c] ?? "").slice(0, 18)).join("  |  "));
        return { lines: [header, ...body].slice(0, 60), isCode: false };
      }
      if (items.length) return { lines: items.map((it) => `${it.done ? "☑" : "☐"} ${it.text}`).slice(0, 60), isCode: false };
    }
    if (ev.windowType === "code" || ev.windowType === "json") {
      const code = typeof data === "string" ? data : (data as Record<string, unknown>)?.code ? String((data as Record<string, unknown>).code) : raw;
      return { lines: code.split("\n").slice(0, 80), isCode: true };
    }
    if (ev.windowType === "document" || ev.windowType === "html" || ev.windowType === "markdown") {
      const txt = typeof data === "string" ? data : (data as Record<string, unknown>)?.content ? String((data as Record<string, unknown>).content) : raw;
      if (txt.trim().startsWith("<") && txt.includes("</")) {
        // html crudo: strip tags y deja texto
        const stripped = txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        // intenta también renderMarkdown si parece markdown dentro de html
        return { lines: stripped.match(/.{1,72}(?:\s|$)/g)?.map((s) => s.trim()).slice(0, 60) || [stripped.slice(0, 72)], isCode: false };
      }
      try {
        const html = renderMarkdown(txt);
        const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return { lines: stripped.match(/.{1,72}(?:\s|$)/g)?.map((s) => s.trim()).slice(0, 60) || [stripped.slice(0, 72)], isCode: false };
      } catch {
        return { lines: txt.split("\n").slice(0, 60), isCode: false };
      }
    }
    return { lines: raw.replace(/<[^>]+>/g, " ").split("\n").slice(0, 60), isCode: false };
  }, [ev]);

  const linesPerPage = 18;
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  const safePage = Math.min(page, pageCount - 1);
  const visible = lines.slice(safePage * linesPerPage, (safePage + 1) * linesPerPage);

  useEffect(() => { setPage(0); }, [ev.id]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // fondo
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvasW, canvasH);
    // header
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvasW, 28 * (canvasW / 600));
    ctx.fillStyle = "#38bdf8";
    ctx.font = `600 ${13 * (canvasW / 600)}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const title = `${ev.title || ev.windowType} · ${ev.windowType}${pageCount > 1 ? `  ${safePage + 1}/${pageCount}` : ""}`;
    ctx.fillText(title.slice(0, 64), 10 * (canvasW / 600), 14 * (canvasW / 600));
    // separador
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 28 * (canvasW / 600));
    ctx.lineTo(canvasW, 28 * (canvasW / 600));
    ctx.stroke();
    // contenido
    const startY = 28 * (canvasW / 600) + 14 * (canvasW / 600);
    const lineH = isCode ? 14 * (canvasW / 600) : 16 * (canvasW / 600);
    ctx.font = isCode
      ? `${11 * (canvasW / 600)}px JetBrains Mono, monospace`
      : `${12 * (canvasW / 600)}px system-ui, sans-serif`;
    visible.forEach((l, i) => {
      const y = startY + i * lineH;
      if (y > canvasH - 8) return;
      // color por tipo
      if (isCode) ctx.fillStyle = "#c4b5fd";
      else if (l.startsWith("#")) ctx.fillStyle = "#7dd3fc";
      else if (l.startsWith("☑")) ctx.fillStyle = "#34d399";
      else ctx.fillStyle = "#e2e8f0";
      // wrap simple: corta a 72 chars ya hecho, solo draw
      ctx.fillText(l.slice(0, 88), 10 * (canvasW / 600), y);
    });
    // hint paginación
    if (pageCount > 1) {
      ctx.fillStyle = "#64748b";
      ctx.font = `${10 * (canvasW / 600)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("tap para siguiente página", canvasW / 2, canvasH - 8 * (canvasW / 600));
      ctx.textAlign = "left";
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    setTexture((prev) => {
      prev?.dispose();
      return tex;
    });
    return () => {
      tex.dispose();
    };
  }, [ev, visible, isCode, safePage, pageCount, canvasW, canvasH, backgroundColor, widthMeters, heightMeters]);

  const handleSelect = () => {
    if (pageCount > 1) setPage((p) => (p + 1) % pageCount);
  };

  if (!texture) {
    return (
      <group>
        <mesh>
          <planeGeometry args={[widthMeters, heightMeters]} />
          <meshBasicMaterial color="#0b0f14" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
        <Text position={[0, 0, 0.013]} fontSize={0.016} color="#64748b" anchorX="center" anchorY="middle">
          cargando…
        </Text>
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
