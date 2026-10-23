import { useState } from "react";
import type { DesktopConnectionConfig } from "../lib/desktop";

export function DesktopSetup({ initial }: { initial: DesktopConnectionConfig }) {
  const [backendUrl, setBackendUrl] = useState(initial.backendUrl);
  const [token, setToken] = useState(initial.token);
  const [capabilityToken, setCapabilityToken] = useState(initial.capabilityToken);
  const [mode, setMode] = useState<"local" | "remote">(initial.mode || "remote");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError("");
    try {
      await window.kaliDesktop!.saveConfig({ mode, backendUrl, token, capabilityToken });
      let response = await fetch("/health").catch(() => null);
      // A local kali-core needs a few seconds to boot.
      for (let i = 0; mode === "local" && (!response || !response.ok) && i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        response = await fetch("/health").catch(() => null);
      }
      if (!response) throw new Error("No se pudo contactar con el backend");
      if (!response.ok) throw new Error(`Backend respondió ${response.status}`);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo conectar al backend");
      setBusy(false);
    }
  }

  return <main className="min-h-screen flex items-center justify-center bg-bg text-fg p-6">
    <div className="w-full max-w-lg rounded-2xl border border-border bg-elevated p-6 space-y-5">
      <h1 className="text-2xl font-semibold">Conectar Kali</h1>
      <p className="text-sm text-muted">Elige dónde se ejecuta el motor de Kali. En otro equipo de la red utiliza HTTPS.</p>
      <div className="grid grid-cols-2 gap-2 text-sm" role="radiogroup" aria-label="Modo">
        <button type="button" role="radio" aria-checked={mode === "local"} onClick={() => setMode("local")} className={`rounded-lg border p-3 text-left ${mode === "local" ? "border-accent" : "border-border"}`}><b>Este equipo</b><br /><span className="text-muted">Inicia kali-core en local (requiere kali_core instalado).</span></button>
        <button type="button" role="radio" aria-checked={mode === "remote"} onClick={() => setMode("remote")} className={`rounded-lg border p-3 text-left ${mode === "remote" ? "border-accent" : "border-border"}`}><b>Servidor remoto</b><br /><span className="text-muted">Conecta a un backend ya desplegado.</span></button>
      </div>
      {mode === "remote" && <>
      <label className="block text-sm">URL del backend
        <input className="mt-2 w-full rounded-lg border border-border bg-bg p-3" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="https://companion.local:8444" />
      </label>
      <label className="block text-sm">Token de acceso
        <input className="mt-2 w-full rounded-lg border border-border bg-bg p-3" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      <label className="block text-sm">Token de acciones de escritorio
        <input className="mt-2 w-full rounded-lg border border-border bg-bg p-3" type="password" value={capabilityToken} onChange={(e) => setCapabilityToken(e.target.value)} autoComplete="off" />
      </label>
      </>}
      {error && <p className="text-sm text-err" role="alert">{error}</p>}
      <button className="w-full rounded-lg bg-accent p-3 text-bg font-semibold disabled:opacity-50" disabled={busy || (mode === "remote" && !backendUrl)} onClick={save}>{busy ? "Conectando…" : "Conectar"}</button>
    </div>
  </main>;
}
