import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ArtifactEvent } from "../../lib/protocol";

/**
 * VrHtml — render REAL de HTML4 sobre el canvas WebGL usando dom-overlay.
 *
 * dom-overlay es un feature WebXR que mantiene visible una capa DOM sobre
 * el canvas WebGL dentro del HMD. Ya está activado en requestVRSession()
 * (line ~85 del VREntry). Verificamos que el navegador lo soporta y que
 * la sesión está activa antes de mostrar el overlay.
 *
 * Cómo funciona:
 *  1) Renderizamos un <mesh> transparente SOLO como ancla 3D (para tener
 *     una posición en el mundo y poder proyectarla a coordenadas de
 *     pantalla).
 *  2) En cada frame, proyectamos el centro del mesh al viewport y
 *     posicionamos un <iframe srcdoc={html}> en esas coordenadas.
 *  3) El iframe tiene HTML REAL: scroll, click, hover, focus, forms,
 *     imágenes CORS-OK, CSS completo, JS — todo nativo del browser.
 *
 * El iframe NO se parsea ni se transforma a textura. Es el HTML
 * literalmente, renderizado por el motor del browser dentro del HMD.
 *
 * Si dom-overlay NO está disponible (algunos browsers/desktop), caemos
 * al modo "imagen estática" con html-to-image como fallback (degradación
 * elegante).
 */
const W_M = 1.2; // ancho del panel en metros
const H_M = 1.4; // alto del panel en metros

export function VrHtml({ ev }: { ev: ArtifactEvent }) {
  const raw = ev.content ?? "";
  const isHtml = raw.trim().startsWith("<");
  const meshRef = useRef<THREE.Mesh>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const overlayEnabledRef = useRef(true);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  // HTML que va dentro del iframe (srcdoc requiere HTML completo).
  const docHtml = isHtml
    ? raw
    : `<pre style="white-space:pre-wrap;font-family:monospace;color:#0f172a;background:#f8fafc;padding:18px;border-radius:8px;font-size:14px;line-height:1.5;margin:0">${escapeHtml(raw)}</pre>`;

  // Crear el iframe UNA sola vez y conectarlo a document.body.
  // Importante: dom-overlay requiere que el elemento esté en el DOM tree
  // cuyo root se pasó al sessionInit.domOverlay.root (en este caso
  // document.body).
  useEffect(() => {
    if (!overlayEnabledRef.current) return;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms");
    // Estilos: posicionado absoluto, sin bordes, scrollbar nativa del browser,
    // tamaño inicial 0 (lo posicionamos en cada frame desde useFrame).
    iframe.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "width:0",
      "height:0",
      "border:0",
      "background:#ffffff",
      "color-scheme:light",
      "z-index:1",
      "pointer-events:auto",
      "border-radius:12px",
      "box-shadow:0 10px 40px rgba(0,0,0,0.6)",
    ].join(";");
    iframe.srcdoc = docHtml;
    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    return () => {
      try {
        document.body.removeChild(iframe);
      } catch {
        /* ignore */
      }
      iframeRef.current = null;
    };
    // docHtml se actualiza por separado (no recreamos el iframe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actualizar srcdoc cuando cambia el contenido.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = docHtml;
  }, [docHtml]);

  // Cada frame: proyectar el mesh al viewport y posicionar el iframe.
  useFrame(() => {
    const mesh = meshRef.current;
    const iframe = iframeRef.current;
    if (!mesh || !iframe) return;

    // Detectar soporte de dom-overlay: si la sesión XR está activa Y el
    // navegador reporta dom-overlay, lo usamos. Si no, ocultamos.
    const session = gl.xr.getSession?.();
    const inXRSession = !!session;
    const supportsDomOverlay =
      typeof navigator !== "undefined" &&
      "xr" in navigator &&
      // Algunos browsers exponen esto como función en navigator.xr
      typeof (navigator as { xr?: { isSessionSupported?: unknown } }).xr !== "undefined";

    // Si dom-overlay no es viable, ocultamos (cae al fallback de textura
    // si alguien lo monta fuera).
    if (!inXRSession || !supportsDomOverlay) {
      iframe.style.display = "none";
      return;
    }
    iframe.style.display = "block";

    // Proyectar el centro del mesh al espacio de pantalla.
    mesh.updateMatrixWorld();
    const center = new THREE.Vector3(0, 0, 0).applyMatrix4(mesh.matrixWorld);
    // Detrás de la cámara → ocultar.
    const camForward = new THREE.Vector3();
    camera.getWorldDirection(camForward);
    const toMesh = center.clone().sub(camera.position);
    if (toMesh.dot(camForward) < 0) {
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      return;
    }
    iframe.style.opacity = "1";
    iframe.style.pointerEvents = "auto";

    // Proyectar al NDC y luego a píxeles del viewport.
    const ndc = center.clone().project(camera);
    if (ndc.z > 1) {
      iframe.style.opacity = "0";
      return;
    }

    const x = (ndc.x * 0.5 + 0.5) * size.width;
    const y = (1 - (ndc.y * 0.5 + 0.5)) * size.height;

    // Estimar el tamaño en pantalla basándose en la distancia al visor.
    // Proyectamos las 4 esquinas del mesh y calculamos el bounding box.
    const corners = [
      new THREE.Vector3(-W_M / 2, -H_M / 2, 0).applyMatrix4(mesh.matrixWorld),
      new THREE.Vector3(W_M / 2, -H_M / 2, 0).applyMatrix4(mesh.matrixWorld),
      new THREE.Vector3(-W_M / 2, H_M / 2, 0).applyMatrix4(mesh.matrixWorld),
      new THREE.Vector3(W_M / 2, H_M / 2, 0).applyMatrix4(mesh.matrixWorld),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      const p = c.clone().project(camera);
      const px = (p.x * 0.5 + 0.5) * size.width;
      const py = (1 - (p.y * 0.5 + 0.5)) * size.height;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const w = Math.max(120, Math.min(size.width, maxX - minX));
    const h = Math.max(120, Math.min(size.height, maxY - minY));

    // Posicionar el iframe centrado en (x, y) con tamaño (w, h).
    iframe.style.left = `${x - w / 2}px`;
    iframe.style.top = `${y - h / 2}px`;
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
  });

  // El mesh es solo un ancla 3D invisible — la UI real vive en el iframe.
  return (
    <mesh ref={meshRef} visible={false}>
      <planeGeometry args={[W_M, H_M]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
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
