import { useEffect, useState } from "react";
import * as THREE from "three";
import { Image } from "@react-three/uikit";

/** Cache global de texturas: remounts del panel no re-descargan ni parpadean. */
const texCache = new Map<string, THREE.Texture>();
const pending = new Map<string, Promise<THREE.Texture | null>>();

function loadTexture(url: string): Promise<THREE.Texture | null> {
  const hit = texCache.get(url);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(url);
  if (inFlight) return inFlight;
  const p = new Promise<THREE.Texture | null>((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        texCache.set(url, t);
        resolve(t);
      },
      undefined,
      () => resolve(null),
    );
  });
  pending.set(url, p);
  p.finally(() => pending.delete(url));
  return p;
}

type Props = {
  url: string;
  width?: number | string;
  height?: number | string;
  objectFit?: "fill" | "cover";
};

/**
 * Image de uikit con textura cacheada a nivel módulo.
 * Mientras carga renderiza null (el contenedor con fondo queda visible).
 * Al mover/agarrar el panel la textura ya está en cache — no se oscurece.
 */
export function SafeImage({ url, width, height, objectFit }: Props) {
  const [tex, setTex] = useState<THREE.Texture | null>(() => texCache.get(url) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    const hit = texCache.get(url);
    if (hit) {
      setTex(hit);
      return;
    }
    setTex(null);
    loadTexture(url).then((t) => {
      if (!alive) return;
      if (t) setTex(t);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  if (failed || !tex) return null;
  return <Image src={tex} width={width as number} height={height as number} objectFit={objectFit ?? "cover"} />;
}
