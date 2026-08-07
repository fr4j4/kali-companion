import { getSidecarPort } from "./sidecar";

export async function apiBase(): Promise<string> {
  // Devuelve ruta vacía (URL relativa) para que el browser use el mismo
  // scheme/origen que la página. Esto evita mixed active content cuando
  // la página está en HTTPS (e.g. https://companion.local/) y el backend
  // está en HTTP interno. Vite/nginx proxy se encargan de rutear /stt, /api,
  // /voices, /llm etc. hacia kali-core.
  await getSidecarPort();
  return "";
}

export async function fetchWithRetry(
  url: string,
  opts?: RequestInit,
  tries: number = 5,
  baseDelay: number = 400,
): Promise<Response | null> {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const resp = await fetch(url, opts);
      return resp;
    } catch (err) {
      if (attempt >= tries) return null;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
    }
  }
  return null;
}
