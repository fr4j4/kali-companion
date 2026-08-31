import { useEffect, useState } from "react";
import { MSDF } from "@zappar/msdf-generator";
import type { FontFamily } from "@zappar/msdf-generator";
import workerUrl from "@zappar/msdf-generator/worker.js?worker&url";
import wasmUrl from "@zappar/msdf-generator/msdfgen_wasm.wasm?url";

// Charset completo: ASCII imprimible + Latin-1 con tildes españolas
const CHARSET =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
  "ÁÉÍÓÚÑÜáéíóúñü¿¡°ªº«»—–…€çÇßöäÅæøåÆØèìòùÌÒÙ";

let cached: FontFamily | null = null;
let pending: Promise<FontFamily> | null = null;

async function generate(): Promise<FontFamily> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    const msdf = new MSDF({ workerUrl, wasmUrl });
    await msdf.initialize();
    const buf = await fetch("/fonts/Inter.ttf").then((r) => r.arrayBuffer());
    // Un solo TTF variable -> genera weight 400 normal; uikit hace fallback para bold
    const result = await msdf.generate({
      font: new Uint8Array(buf),
      charset: CHARSET,
      fontSize: 48,
      textureSize: [1024, 1024],
      fieldRange: 4,
      fixOverlaps: true,
    });
    await msdf.dispose();
    cached = result;
    return result;
  })();
  return pending;
}

/** Hook: genera el atlas MSDF de Inter con tildes. null mientras genera. */
export function useVrFont(): FontFamily | null {
  const [font, setFont] = useState<FontFamily | null>(cached);
  useEffect(() => {
    if (font) return;
    let alive = true;
    generate()
      .then((f: FontFamily) => { if (alive) setFont(f); })
      .catch((e: unknown) => console.error("[useVrFont] msdf fail", e));
    return () => { alive = false; };
  }, [font]);
  return font;
}

/** Nombre de la familia generada (atlas.info.name) — usar en fontFamily. */
export const VR_FONT_FAMILY = "Inter";
