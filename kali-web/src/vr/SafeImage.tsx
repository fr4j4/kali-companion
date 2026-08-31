import { useEffect, useState } from "react";
import * as THREE from "three";
import { Image } from "@react-three/uikit";

type Props = {
  url: string;
  width?: number | string;
  height?: number | string;
  objectFit?: "fill" | "cover";
};

/**
 * Image de uikit con textura precargada via THREE.TextureLoader
 * (crossOrigin anonymous). Renderiza null hasta que carga — el
 * contenedor con fondo queda visible, sin flash negro.
 */
export function SafeImage({ url, ...rest }: Props) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setTex(null);
    setFailed(false);
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (!alive) return;
        t.colorSpace = THREE.SRGBColorSpace;
        setTex(t);
      },
      undefined,
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [url]);
  if (failed || !tex) return null;
  return <Image src={tex} width={rest.width as number} height={rest.height as number} objectFit={rest.objectFit ?? "cover"} />;
}
