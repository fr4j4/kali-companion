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

// Auth token for kali-core HTTP endpoints. Stored by the user in
// localStorage (kali.apiToken); empty when the core has no auth enabled.
export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("kali.apiToken") || "";
  if (!token) return {};
  return { "X-API-Token": token };
}

export async function fetchWithRetry(
  url: string,
  opts?: RequestInit,
  tries: number = 5,
  baseDelay: number = 400,
): Promise<Response | null> {
  const merged: RequestInit = {
    ...opts,
    headers: { ...authHeaders(), ...((opts?.headers as Record<string, string>) ?? {}) },
  };
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const resp = await fetch(url, merged);
      return resp;
    } catch (err) {
      if (attempt >= tries) return null;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
    }
  }
  return null;
}
