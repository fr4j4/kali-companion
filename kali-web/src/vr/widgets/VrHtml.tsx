import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { toCanvas } from "html-to-image";
import type { ArtifactEvent } from "../../lib/protocol";

/**
 * VrHtml — render REAL de HTML4 en un mesh WebGL.
 *
 * Estrategia robusta usando `html-to-image` (instalado) que internamente
 * usa SVG-foreignObject vía DATA URL (no blob URL) — esto evita el
 * "taint" del canvas en Chrome y por tanto la imagen blanca.
 *
 * Pipeline:
 *   1. Crear un HTMLElement off-screen con el HTML parseado por el browser
 *      (parser nativo: respeta TODO CSS, imágenes, formularios, scroll).
 *   2. `toCanvas(el)` de html-to-image: serializa el DOM a SVG (con
 *      foreignObject), lo carga como Image vía data URL (no blob), y lo
 *      dibuja en un canvas 2D. El canvas resultante NO está tainted.
 *   3. Subimos el canvas como THREE.CanvasTexture en un planeGeometry.
 *
 * El HTMLElement está fuera del flujo principal del DOM (position:absolute;
 * left:-99999px; visibility:hidden) para no afectar el render del browser.
 */
const W_PX = 600;
const H_PX = 700;
const SCALE = 0.002;
const MESH_W = W_PX * SCALE;
const MESH_H = H_PX * SCALE;

export function VrHtml({ ev }: { ev: ArtifactEvent }) {
  const raw = ev.content ?? "";
  const isHtml = raw.trim().startsWith("<");
  const meshRef = useRef<THREE.Mesh>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // HTML envuelto para el HTMLElement off-screen.
  const docHtml = useMemo(() => {
    const body = isHtml
      ? raw
      : `<pre style="white-space:pre-wrap;font-family:monospace;color:#0f172a;background:#f1f5f9;padding:14px;border-radius:6px;font-size:14px;line-height:1.5">${escapeHtml(raw)}</pre>`;
    return `<div xmlns="http://www.w3.org/1999/xhtml" style="
      width:${W_PX}px;height:${H_PX}px;box-sizing:border-box;
      background:#ffffff;color:#0f172a;
      font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      padding:14px;overflow:auto;border-radius:8px;
    "><style>
      h1{font-size:22px;margin:0 0 10px;color:#0ea5e9;font-weight:700;}
      h2{font-size:18px;margin:14px 0 8px;color:#0369a1;font-weight:700;}
      h3{font-size:15px;margin:12px 0 6px;color:#075985;font-weight:600;}
      p{font-size:14px;line-height:1.5;margin:0 0 10px;}
      a{color:#0ea5e9;text-decoration:underline;}
      button{font-family:inherit;font-size:13px;}
      input,textarea,select{font-family:inherit;font-size:14px;}
      pre{font-size:12px;background:#f1f5f9;padding:10px;border-radius:6px;overflow:auto;color:#0f172a;}
      code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f1f5f9;padding:2px 4px;border-radius:3px;}
      table{border-collapse:collapse;width:100%;font-size:13px;}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;color:#0f172a;}
      th{background:#e2e8f0;font-weight:600;}
      ul,ol{padding-left:22px;font-size:14px;}
      img{max-width:100%;height:auto;}
      details>summary{cursor:pointer;font-weight:600;}
      hr{border:none;border-top:1px solid #e2e8f0;margin:10px 0;}
      *{box-sizing:border-box;}
    </style>${body}</div>`;
  }, [raw, isHtml]);

  // Crear el contenedor off-screen UNA sola vez.
  useEffect(() => {
    const host = document.createElement("div");
    host.style.cssText =
      "position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;";
    document.body.appendChild(host);
    hostRef.current = host;
    return () => {
      try {
        document.body.removeChild(host);
      } catch {
        /* ignore */
      }
      hostRef.current = null;
    };
  }, []);

  // Cuando el contenido cambia, rasterizar.
  useEffect(() => {
    const host = hostRef.current;
    const mesh = meshRef.current;
    if (!host || !mesh) return;

    let cancelled = false;
    let texture: THREE.CanvasTexture | null = null;

    const rasterize = async () => {
      try {
        // Crear el HTMLElement real con el HTML.
        const el = document.createElement("div");
        el.innerHTML = docHtml;
        const firstChild = el.firstElementChild as HTMLElement | null;
        if (!firstChild) return;
        host.appendChild(firstChild);

        // Asegurar dimensiones reales.
        firstChild.style.width = `${W_PX}px`;
        firstChild.style.height = `${H_PX}px`;

        // Esperar un frame para que el browser mida los estilos.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => setTimeout(r, 50));
        if (cancelled) {
          host.removeChild(firstChild);
          return;
        }

        // Convertir a canvas via html-to-image (data URL, NO tainted).
        const canvas = await toCanvas(firstChild, {
          width: W_PX,
          height: H_PX,
          pixelRatio: 1,
          backgroundColor: "#ffffff",
          // Forzar data URL internamente para evitar el taint.
          cacheBust: false,
          skipFonts: false,
        });

        if (cancelled) {
          host.removeChild(firstChild);
          return;
        }

        host.removeChild(firstChild);

        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map = texture;
        mat.color.set("white");
        mat.transparent = false;
        mat.needsUpdate = true;
      } catch (err) {
        console.warn("[VrHtml] rasterizado falló:", err);
      }
    };

    // Diferir al siguiente RAF para no bloquear el primer frame XR.
    const raf = requestAnimationFrame(() => {
      void rasterize();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (texture) texture.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map = null;
      mat.needsUpdate = true;
    };
  }, [docHtml]);

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[MESH_W, MESH_H]} />
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
