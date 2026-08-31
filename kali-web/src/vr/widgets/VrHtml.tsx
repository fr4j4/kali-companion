import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ArtifactEvent } from "../../lib/protocol";

/**
 * VrHtml — render REAL de HTML4 en un mesh WebGL via iframe off-screen.
 *
 * Estrategia robusta que NO depende de polyfills ni de APIs experimentales:
 *   1. Crea un <iframe sandbox="allow-same-origin"> off-screen con srcdoc = HTML.
 *   2. Cuando el iframe carga, su `contentDocument` tiene el HTML parseado
 *      por el browser con CSS real.
 *   3. Serializa el documento a SVG (<foreignObject>), lo carga como Image.
 *   4. Dibuja la imagen en un canvas 2D.
 *   5. Sube el canvas como THREE.CanvasTexture en un planeGeometry.
 *
 * Funciona en XR y en preview DOM (porque solo usa APIs estándar: iframe,
 * XMLSerializer, Image, Canvas 2D). NO requiere polyfill de html-in-canvas.
 *
 * Tamaño: 600x700 px -> mesh 1.2x1.4 m (escala 0.002 m/px del resto del VR).
 */
const W_PX = 600;
const H_PX = 700;
const SCALE = 0.002;
const MESH_W = W_PX * SCALE; // 1.2 m
const MESH_H = H_PX * SCALE; // 1.4 m

export function VrHtml({ ev }: { ev: ArtifactEvent }) {
  const raw = ev.content ?? "";
  const isHtml = raw.trim().startsWith("<");
  const meshRef = useRef<THREE.Mesh>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // 1) HTML envuelto para el iframe.
  const docHtml = useMemo(() => {
    const body = isHtml
      ? raw
      : `<pre style="white-space:pre-wrap;font-family:monospace;color:#0f172a;background:#f1f5f9;padding:14px;border-radius:6px;font-size:14px;line-height:1.5">${escapeHtml(raw)}</pre>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#ffffff;color:#0f172a;
        font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        width:${W_PX}px;height:${H_PX}px;box-sizing:border-box;
        overflow:auto;-webkit-overflow-scrolling:touch;}
      *{box-sizing:border-box;}
      h1{font-size:22px;margin:0 0 10px;color:#0ea5e9;}
      h2{font-size:18px;margin:14px 0 8px;color:#0369a1;}
      p{font-size:14px;line-height:1.5;margin:0 0 10px;}
      a{color:#0ea5e9;text-decoration:underline;}
      button{font-family:inherit;font-size:13px;}
      input,textarea{font-family:inherit;font-size:14px;}
      pre{font-size:12px;background:#f1f5f9;padding:10px;border-radius:6px;overflow:auto;}
      code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f1f5f9;padding:2px 4px;border-radius:3px;}
      table{border-collapse:collapse;width:100%;font-size:13px;}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;}
      th{background:#e2e8f0;font-weight:600;}
      ul,ol{padding-left:22px;font-size:14px;}
      img{max-width:100%;height:auto;}
      details>summary{cursor:pointer;font-weight:600;}
      hr{border:none;border-top:1px solid #e2e8f0;margin:10px 0;}
    </style></head><body>${body}</body></html>`;
  }, [raw, isHtml]);

  // 2) Crear iframe off-screen UNA sola vez, DIFERIDO para no bloquear
  // el primer frame al entrar en VR. El iframe se monta en el siguiente RAF
  // después del primer paint. Se inserta en un wrapper #vr-html-iframes
  // separado del DOM principal, con position:absolute fuera del viewport
  // para no afectar el WebGL canvas ni la geometría del browser.
  useEffect(() => {
    let cancelled = false;
    let iframe: HTMLIFrameElement | null = null;
    let wrapper: HTMLDivElement | null = null;

    const mount = () => {
      if (cancelled) return;
      let host = document.getElementById("vr-html-iframes");
      if (!host) {
        host = document.createElement("div");
        host.id = "vr-html-iframes";
        host.style.cssText =
          "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;left:-99999px;top:-99999px;";
        document.body.appendChild(host);
      }
      wrapper = document.createElement("div");
      wrapper.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
      iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-same-origin");
      iframe.style.cssText = `position:absolute;width:${W_PX}px;height:${H_PX}px;border:0;visibility:hidden;pointer-events:none;left:0;top:0;`;
      iframe.srcdoc = docHtml;
      wrapper.appendChild(iframe);
      host.appendChild(wrapper);
      iframeRef.current = iframe;
    };

    const raf = requestAnimationFrame(() => mount());

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      iframeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3) Actualizar srcdoc cuando cambia el contenido.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = docHtml;
    // Resetear la textura mientras el iframe recarga.
    const mesh = meshRef.current;
    if (mesh) {
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map = null;
      mat.color.set("white");
      mat.needsUpdate = true;
    }
  }, [docHtml]);

  // 4) Cuando el iframe termina de cargar, rasterizar a canvas y subir textura.
  useEffect(() => {
    const iframe = iframeRef.current;
    const mesh = meshRef.current;
    if (!iframe || !mesh) return;

    let disposed = false;
    let texture: THREE.CanvasTexture | null = null;

    const rasterize = async () => {
      try {
        // Esperar a que el iframe esté listo.
        const doc = iframe.contentDocument;
        if (!doc) return;
        // Esperar a imágenes/fonts si las hay (timeout corto).
        await waitForAssets(doc, 800);

        // Serializar el documento a SVG (foreignObject permite HTML real dentro).
        const svg = svgFromDocument(doc);
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = (e) => reject(e);
          img.src = url;
        });

        if (disposed) {
          URL.revokeObjectURL(url);
          return;
        }

        // Pintar la imagen del SVG en un canvas 2D.
        const canvas = document.createElement("canvas");
        canvas.width = W_PX;
        canvas.height = H_PX;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W_PX, H_PX);
        ctx.drawImage(img, 0, 0, W_PX, H_PX);
        URL.revokeObjectURL(url);

        if (disposed) return;

        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map = texture;
        mat.opacity = 1;
        mat.transparent = false;
        mat.color.set("white");
        mat.needsUpdate = true;
      } catch (err) {
        console.warn("[VrHtml] rasterizado falló:", err);
      }
    };

    const onLoad = () => {
      void rasterize();
    };
    iframe.addEventListener("load", onLoad);
    // Si ya está cargado (caso race), llamar directamente.
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
        void rasterize();
      }
    } catch {
      /* sandbox: ignore */
    }

    return () => {
      disposed = true;
      iframe.removeEventListener("load", onLoad);
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

/** Espera a imágenes dentro del documento, hasta `timeoutMs`. */
function waitForAssets(doc: Document, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const imgs = Array.from(doc.images || []);
    let pending = imgs.filter((i) => !i.complete).length;
    if (pending === 0) {
      resolve();
      return;
    }
    const t = setTimeout(() => resolve(), timeoutMs);
    imgs.forEach((img) => {
      if (img.complete) return;
      img.addEventListener(
        "load",
        () => {
          pending--;
          if (pending <= 0) {
            clearTimeout(t);
            resolve();
          }
        },
        { once: true },
      );
      img.addEventListener(
        "error",
        () => {
          pending--;
          if (pending <= 0) {
            clearTimeout(t);
            resolve();
          }
        },
        { once: true },
      );
    });
  });
}

/** Serializa un Document a un SVG con foreignObject (XHTML válido). */
function svgFromDocument(doc: Document): string {
  // Clonar para no mutar el original.
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  // Forzar xmlns.
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  // CSS calculado de elementos: inline styles para que foreignObject respete el render.
  inlineComputedStyles(doc, clone);
  const xhtml = new XMLSerializer().serializeToString(clone);
  // Escapar para meter en data URL.
  const escaped = xhtml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W_PX}" height="${H_PX}" viewBox="0 0 ${W_PX} ${H_PX}">
    <foreignObject x="0" y="0" width="100%" height="100%">${escaped}</foreignObject>
  </svg>`;
}

/** Copia estilos computados clave de cada elemento del doc original al clon. */
function inlineComputedStyles(src: Document, dst: HTMLElement): void {
  const srcEls = Array.from(src.querySelectorAll("*"));
  const dstEls = Array.from(dst.querySelectorAll("*"));
  const props = [
    "color",
    "background-color",
    "background-image",
    "background",
    "font-size",
    "font-weight",
    "font-style",
    "font-family",
    "text-align",
    "line-height",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "border",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-radius",
    "display",
    "flex",
    "flex-direction",
    "justify-content",
    "align-items",
    "gap",
    "grid-template-columns",
    "width",
    "height",
    "max-width",
    "max-height",
    "min-width",
    "min-height",
    "box-shadow",
    "opacity",
    "text-decoration",
    "text-transform",
    "list-style",
    "list-style-type",
    "overflow",
  ];
  for (let i = 0; i < Math.min(srcEls.length, dstEls.length); i++) {
    const s = srcEls[i];
    const d = dstEls[i] as HTMLElement;
    const cs = (s.ownerDocument?.defaultView ?? window).getComputedStyle(s);
    let inline = "";
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "" && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px") {
        inline += `${p}:${v};`;
      }
    }
    if (inline) d.setAttribute("style", inline);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
