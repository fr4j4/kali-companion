import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ArtifactEvent } from "../../lib/protocol";

/**
 * VrHtml — render REAL de HTML4 sobre el canvas WebGL usando dom-overlay.
 *
 * dom-overlay es un feature WebXR (ya activado en requestVRSession) que
 * mantiene visible una capa DOM sobre el canvas WebGL dentro del HMD.
 * Poner un <iframe srcdoc={html}> en esa capa hace que el HTML se vea
 * NATIVO en el visor: scroll, click, hover, focus, forms, JS — todo real.
 *
 * Estrategia:
 *  - Anclamos el iframe a la cámara HMD (head-locked overlay): el HTML
 *    siempre está frente a tus ojos, a una distancia fija en píxeles,
 *    escalado según el FOV. Esto evita depender de la proyección de un
 *    mesh 3D (que falla cuando useFrame no se ejecuta en meshes
 *    invisibles, o cuando la cámara XR no tiene size actualizado).
 *  - El componente sigue devolviendo un <mesh> invisible (ancla) por
 *    compatibilidad con el árbol React; pero el iframe es head-locked.
 *  - En el lobby 2D (sin sesión XR), el iframe se oculta y el panel usa
 *    el contenido como respaldo drei <Html>.
 */
const W_PX = 600;
const H_PX = 700;

export function VrHtml({ ev }: { ev: ArtifactEvent }) {
  const raw = ev.content ?? "";
  const isHtml = raw.trim().startsWith("<");
  const meshRef = useRef<THREE.Mesh>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const size = useThree((s) => s.size);

  // HTML que va dentro del iframe.
  const docHtml = isHtml
    ? raw
    : `<pre style="white-space:pre-wrap;font-family:monospace;color:#0f172a;background:#f8fafc;padding:18px;border-radius:8px;font-size:14px;line-height:1.5;margin:0">${escapeHtml(raw)}</pre>`;

  // Crear el iframe UNA sola vez.
  useEffect(() => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute(
      "sandbox",
      "allow-same-origin allow-scripts allow-forms",
    );
    iframe.setAttribute("allow", "fullscreen");
    iframe.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:50%",
      "width:600px",
      "height:700px",
      "transform:translate(-50%,-50%)",
      "border:0",
      "background:#ffffff",
      "color-scheme:light",
      "z-index:10",
      "pointer-events:auto",
      "border-radius:12px",
      "box-shadow:0 10px 40px rgba(0,0,0,0.6)",
      "display:none",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actualizar srcdoc cuando cambia el contenido.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = docHtml;
  }, [docHtml]);

  // Cada frame: detectar si hay sesión XR y posicionar/escalar el iframe.
  // El iframe va centrado en pantalla, escalado al ~50% del ancho para que
  // sea legible pero no tape todo el campo de visión. Esto se actualiza
  // en cada frame para reaccionar a cambios de tamaño del canvas.
  useFrame(({ gl }) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const session = gl.xr.getSession?.();
    const inXRSession = !!session;

    if (!inXRSession) {
      // En lobby 2D no usamos el iframe; el widget drei <Html> lo maneja.
      iframe.style.display = "none";
      return;
    }
    iframe.style.display = "block";

    // En XR, el visor renderiza en un viewport interno. `size` de r3f
    // refleja el tamaño del framebuffer (generalmente la mitad por ojo).
    // Usamos un tamaño relativo al viewport: 60% del ancho, 70% del alto.
    const sw = size.width;
    const sh = size.height;
    const targetW = Math.min(W_PX, sw * 0.6);
    const targetH = Math.min(H_PX, sh * 0.7);
    iframe.style.width = `${targetW}px`;
    iframe.style.height = `${targetH}px`;
    iframe.style.left = "50%";
    iframe.style.top = "50%";
    iframe.style.transform = "translate(-50%,-50%)";
  });

  // Ancla invisible (compatibilidad con el árbol React; no se renderiza).
  return (
    <mesh ref={meshRef} visible={false}>
      <planeGeometry args={[1, 1]} />
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
