import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getHtmlRenderer } from "three-html-render/polyfill";
import type { ArtifactEvent } from "../../lib/protocol";

/**
 * VrHtml — render REAL de HTML en un mesh WebGL.
 *
 * Usa `three-html-render` (instalado) que rasteriza un HTMLElement a una
 * textura WebGL vía SVG-foreignObject y la sube como `map` del mesh.
 * El HTML se procesa dentro del DOM (parser nativo del browser) y se
 * renderiza con CSS real: headers, párrafos, listas, botones, inputs,
 * tablas, imágenes (si tienen CORS), etc.
 *
 * Limitaciones en VR HMD:
 * - inputs/textarea funcionan pero requieren re-rasterizar al escribir
 *   (`requestPaint` se invoca automáticamente en eventos input/scroll).
 * - la interactividad por click sobre los elementos del HTML no se
 *   propaga al raycast XR (es solo una textura), pero el panel completo
 *   sigue siendo arrastrable y cerrable por el header.
 */
export function VrHtml({ ev }: { ev: ArtifactEvent }) {
  const raw = ev.content ?? "";
  const isHtml = raw.trim().startsWith("<");

  // Elemento HTML real (off-screen, position absolute, fixed size).
  // El tamaño en CSS px se mapea al tamaño del mesh en metros (escala
  // 0.002 metro/px igual que el resto de los paneles VR).
  const W_PX = 600;
  const H_PX = 700;
  const elementRef = useRef<HTMLDivElement | null>(null);

  // Construimos el HTML que va dentro del contenedor. Si el contenido no
  // parece HTML, lo envolvemos como texto.
  const innerHtml = useMemo(() => {
    if (!isHtml) {
      return `<pre style="white-space:pre-wrap;font-family:monospace;color:#0f172a;background:#f1f5f9;padding:12px;border-radius:6px;">${escapeHtml(raw)}</pre>`;
    }
    // Asegurar DOCTYPE/xhtml envoltura para el rasterizador.
    return raw;
  }, [raw, isHtml]);

  // Crear el elemento una sola vez y mantenerlo estable entre renders.
  if (!elementRef.current) {
    const el = document.createElement("div");
    el.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    el.style.cssText = `width:${W_PX}px;height:${H_PX}px;overflow:auto;color:#0f172a;font-family:system-ui,-apple-system,sans-serif;background:#ffffff;padding:14px;box-sizing:border-box;border-radius:8px;`;
    el.innerHTML = innerHtml;
    elementRef.current = el;
  }

  // Cada vez que cambia innerHtml, lo volcamos al elemento y pedimos repaint.
  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    el.innerHTML = innerHtml;
    // Re-rasterizar
    const htmlRenderer = getHtmlRenderer();
    void htmlRenderer.update(el);
  }, [innerHtml]);

  // Crear el mesh con la textura del HTML.
  const meshRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const el = elementRef.current;
    const mesh = meshRef.current;
    if (!el || !mesh) return;

    let disposed = false;
    let texture: THREE.Texture | null = null;
    try {
      // update() rasteriza y sube la textura al cache del HtmlRenderer.
      const htmlRenderer = getHtmlRenderer();
      void htmlRenderer.update(el).then(() => {
        if (disposed) return;
        const canvas = htmlRenderer.getCanvas(el);
        if (!canvas) return;
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map = texture;
        mat.needsUpdate = true;
      });
    } catch (err) {
      console.warn("[VrHtml] fallo de rasterizado", err);
    }

    return () => {
      disposed = true;
      texture?.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map = null;
      mat.needsUpdate = true;
    };
  }, [innerHtml]);

  // Dimensiones del mesh en metros (escala 0.002 m/px consistente con el resto).
  const W = W_PX * 0.002; // 1.2 m
  const H = H_PX * 0.002; // 1.4 m

  return (
    <mesh ref={meshRef} scale={[W, H, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent side={THREE.DoubleSide} color="white" />
    </mesh>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
