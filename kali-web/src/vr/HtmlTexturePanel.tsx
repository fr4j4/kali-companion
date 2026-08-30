import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { toCanvas } from "html-to-image";
import type { ArtifactEvent } from "../lib/protocol";
import { widgetRegistry } from "../components/widgets/widgetRegistry";
import type { WindowType } from "../workspace/types";
import { Text } from "@react-three/drei";

/**
 * HtmlTexturePanel — render fiel del widget del canvas dentro del HMD.
 *
 * Estrategia: hidden div offscreen (-9999px) + React root → html-to-image
 * toCanvas() → CanvasTexture sobre Plane. Es la vía estándar para VR
 * (CSS3D/Html no se ve en XR). Se redibuja cuando ev.content cambia.
 * Grip se maneja fuera (GripGrab envuelve este mesh).
 */
export function HtmlTexturePanel({
  ev,
  widthMeters = 0.86,
  heightMeters = 0.62,
  pixelsPerMeter = 650,
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);
  const latestEvRef = useRef(ev);
  latestEvRef.current = ev;

  const wt = ev.windowType as WindowType;
  const entry = widgetRegistry[wt];
  const Widget = entry?.component;

  const canvasW = Math.round(widthMeters * pixelsPerMeter);
  const canvasH = Math.round(heightMeters * pixelsPerMeter);

  // Crea el hidden container una vez
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
      try {
        rootRef.current?.unmount();
      } catch {}
      if (div.parentNode) div.parentNode.removeChild(div);
      containerRef.current = null;
      rootRef.current = null;
    };
  }, [canvasW, canvasH, backgroundColor]);

  // Renderiza el widget offscreen y rasteriza a texture
  useEffect(() => {
    let cancelled = false;
    const div = containerRef.current;
    const root = rootRef.current;
    if (!div || !root) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const triggerRender = () => {
      // flushSync para que el DOM esté listo antes del toCanvas
      flushSync(() => {
        if (Widget) {
          root.render(
            <div style={{ width: canvasW, minHeight: canvasH, background: backgroundColor, padding: 0 }}>
              {/* header simple para el offscreen (luego el mesh ya tiene header nativo si queremos) */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderBottom: "1px solid #1e293b",
                  background: "#111827",
                  color: "#38bdf8",
                  fontSize: 13,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(ev.title || ev.windowType) + " · " + ev.windowType}
                </span>
              </div>
              <div style={{ padding: 8, maxHeight: canvasH - 28, overflow: "hidden" }}>
                <Widget content={ev} />
              </div>
            </div>,
          );
        } else {
          root.render(
            <div style={{ width: canvasW, minHeight: canvasH, background: "#e2e8f0", color: "#04070a", padding: 12, fontFamily: "system-ui, sans-serif", fontSize: 12, whiteSpace: "pre-wrap" }}>
              {ev.content?.slice(0, 4000) ?? "(vacío)"}
            </div>,
          );
        }
      });
    };

    const doCapture = async () => {
      triggerRender();
      // espera a que el DOM pinte (imagenes, shiki)
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 16));
        if ((div.firstChild as HTMLElement | null)?.offsetHeight) break;
      }
      // pequeño delay extra para highlight.js/shiki async
      await new Promise((r) => setTimeout(r, 80));
      const target = div.firstChild as HTMLElement | null;
      if (!target) {
        if (!cancelled) setError("sin target");
        return;
      }
      try {
        const canvas = await toCanvas(target as HTMLElement, {
          cacheBust: false,
          pixelRatio: 2,
          backgroundColor,
          skipFonts: true,
        } as never);
        if (cancelled) return;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        setTexture((prev) => {
          prev?.dispose();
          return tex;
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120));
      }
    };

    void doCapture();
    return () => {
      cancelled = true;
    };
  }, [ev, Widget, canvasW, canvasH, backgroundColor]);

  useEffect(() => {
    return () => {
      texture?.dispose();
    };
  }, [texture]);

  // Geometría del panel — mismo tamaño que el marco usado antes
  const material = useMemo(() => {
    if (!texture) return null;
    return new THREE.MeshBasicMaterial({ map: texture, transparent: false, side: THREE.DoubleSide });
  }, [texture]);

  // Cleanup material
  useEffect(() => {
    return () => {
      material?.dispose();
    };
  }, [material]);

  if (error) {
    return (
      <group>
        <mesh>
          <planeGeometry args={[widthMeters, heightMeters]} />
          <meshBasicMaterial color="#0b0f14" side={THREE.DoubleSide} />
        </mesh>
        <Text position={[0, 0, 0.012]} fontSize={0.02} color="#fb7185" anchorX="center" anchorY="middle" maxWidth={widthMeters - 0.06}>
          {error}
        </Text>
      </group>
    );
  }

  if (!texture || !material) {
    return (
      <group>
        <mesh>
          <planeGeometry args={[widthMeters, heightMeters]} />
          <meshBasicMaterial color="#0b0f14" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
        <Text position={[0, 0, 0.012]} fontSize={0.018} color="#64748b" anchorX="center" anchorY="middle">
          cargando…
        </Text>
      </group>
    );
  }

  return (
    <mesh>
      <planeGeometry args={[widthMeters, heightMeters]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
