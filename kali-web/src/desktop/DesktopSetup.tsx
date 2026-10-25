import { useState } from "react";
import type { DesktopConnectionConfig } from "../lib/desktop";

export function DesktopSetup({ initial }: { initial: DesktopConnectionConfig }) {
  const [backendUrl, setBackendUrl] = useState(initial.backendUrl);
  const [token, setToken] = useState(initial.token);
  const [capabilityToken, setCapabilityToken] = useState(initial.capabilityToken);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError("");
    try {
      await window.kaliDesktop!.saveConfig({ backendUrl, token, capabilityToken });
      const response = await fetch("/health");
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
      <p className="text-sm text-muted">Configura la dirección del backend independiente. En otro equipo de la red utiliza HTTPS.</p>
      <label className="block text-sm">URL del backend
        <input className="mt-2 w-full rounded-lg border border-border bg-bg p-3" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="https://companion.local:8444" />
      </label>
      <label className="block text-sm">Token de acceso
        <input className="mt-2 w-full rounded-lg border border-border bg-bg p-3" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      <label className="block text-sm">Token de acciones de escritorio
        <input className="mt-2 w-full rounded-lg border border-border bg-bg p-3" type="password" value={capabilityToken} onChange={(e) => setCapabilityToken(e.target.value)} autoComplete="off" />
      </label>
      {error && <p className="text-sm text-err" role="alert">{error}</p>}
      <button className="w-full rounded-lg bg-accent p-3 text-bg font-semibold disabled:opacity-50" disabled={busy || !backendUrl} onClick={save}>{busy ? "Conectando…" : "Conectar"}</button>
    </div>
  </main>;
}
