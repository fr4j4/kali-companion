// Helper para resolver el puerto del sidecar (kali-core).
//
// En Electron: window.kali.getSidecarPort() lo provee el shell vía contextBridge.
// En dev (Vite): se usa VITE_KALI_PORT (env).
// En prod (no usado para construir URLs): la implementación queda por
// compatibilidad con kali-shell (Electron), donde el WS client sí necesita
// un puerto explícito.
//
// NOTA: en este frontend (kali-web) actualmente NO se usa para construir
// URLs — `apiBase()` retorna "" (URL relativa) para evitar mixed active
// content cuando la página entra por HTTPS. Mantener este helper para
// futura consolidación de las N variantes dispersas por el codebase.

import { authHeaders } from "./http";

export async function getSidecarPort(): Promise<number | null> {
  const w = window as unknown as { kali?: { getSidecarPort?: () => Promise<number | null> } };
  if (w.kali?.getSidecarPort) {
    return await w.kali.getSidecarPort();
  }
  const envPort = import.meta.env.VITE_KALI_PORT;
  if (envPort) return Number(envPort);
  try {
    const resp = await fetch("/api/sidecar-port", { headers: authHeaders() });
    if (resp.ok) {
      const data = await resp.json();
      return data.port ?? 8900;
    }
  } catch {
    // ignore
  }
  return 8900;
}
