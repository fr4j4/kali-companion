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
    // Fuente estática real (DejaVu Sans, latin completo con tildes).
    // El Inter.ttf anterior era un HTML 404 descargado por error.
    const regular = await fetch("/fonts/PanelSans.ttf").then((r) => {
      if (!r.ok) throw new Error(`font regular ${r.status}`);
      return r.arrayBuffer();
    });
    const bold = await fetch("/fonts/PanelSans-Bold.ttf").then((r) => {
      if (!r.ok) throw new Error(`font bold ${r.status}`);
      return r.arrayBuffer();
    });
    const result = await msdf.generate({
      fonts: [
        { font: new Uint8Array(regular), charset: CHARSET, fontSize: 48, textureSize: [1024, 1024] },
        { font: new Uint8Array(bold), charset: CHARSET, fontSize: 48, textureSize: [1024, 1024] },
      ] as unknown as [{ font: Uint8Array }, { font: Uint8Array }],
      fieldRange: 4,
      fixOverlaps: true,
    } as never);
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
