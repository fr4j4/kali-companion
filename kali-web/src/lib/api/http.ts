export async function getSidecarPort(): Promise<number | null> {
  const w = window as unknown as { kali?: { getSidecarPort?: () => Promise<number | null> } };
  if (w.kali?.getSidecarPort) {
    return await w.kali.getSidecarPort();
  }
  const envPort = import.meta.env.VITE_KALI_PORT;
  if (envPort) return Number(envPort);
  try {
    const resp = await fetch("/api/sidecar-port");
    if (resp.ok) {
      const data = await resp.json();
      return data.port ?? 8900;
    }
  } catch {
  }
  return 8900;
}

export async function apiBase(): Promise<string> {
  const port = await getSidecarPort();
  const host = window.location.hostname;
  return `http://${host}:${port ?? 8900}`;
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