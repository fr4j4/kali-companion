import { useState } from "react";
import { getDesktopConfig } from "../lib/desktop";

export function DesktopConnectionSettings() {
  const config = getDesktopConfig();
  const [mode, setMode] = useState<"local" | "remote">(config?.mode || "remote");
  const [corner, setCorner] = useState<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-right");
  const [backendUrl, setBackendUrl] = useState(config?.backendUrl || "");
  const [token, setToken] = useState(config?.token || "");
  const [capabilityToken, setCapabilityToken] = useState(config?.capabilityToken || "");
  const [showAvatar, setShowAvatar] = useState(config?.showAvatar !== false);
  const [avatarSize, setAvatarSize] = useState(config?.avatarSize || 220);
  const [showText, setShowText] = useState(() => localStorage.getItem("kali.desktop.showText") === "true");
  const [message, setMessage] = useState("");
  if (!window.kaliDesktop) return null;
  return <section className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">Cliente de escritorio</h3>
    <p className="text-xs text-muted">Estas opciones afectan solo este computador.</p>
    {config?.nativeAgent && <p className="text-xs text-muted" role="status">Avatar nativo activo (kali-avatar): gestiona el avatar, la bandeja y las acciones de escritorio.</p>}
    <label className="block text-sm">Modo
      <select className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={mode} onChange={(e) => setMode(e.target.value as "local" | "remote")}>
        <option value="local">Este equipo (kali-core local)</option><option value="remote">Servidor remoto</option>
      </select>
    </label>
    {mode === "remote" && <>
    <label className="block text-sm">Backend
      <input className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
    </label>
    <label className="block text-sm">Token
      <input className="mt-1 w-full rounded-lg border border-border bg-bg p-2" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
    </label>
    <label className="block text-sm">Token de acciones de escritorio
      <input className="mt-1 w-full rounded-lg border border-border bg-bg p-2" type="password" value={capabilityToken} onChange={(e) => setCapabilityToken(e.target.value)} autoComplete="off" />
    </label>
    </>}
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={showAvatar} onChange={async (e) => { setShowAvatar(e.target.checked); await window.kaliDesktop!.showAvatar(e.target.checked); }} /> Mostrar avatar flotante
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={showText} onChange={(e) => { setShowText(e.target.checked); localStorage.setItem("kali.desktop.showText", String(e.target.checked)); }} /> Mostrar texto junto al avatar
    </label>
    <label className="block text-sm">Tamaño del avatar
      <select className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={avatarSize} onChange={(e) => { const size = Number(e.target.value); setAvatarSize(size); void window.kaliDesktop!.setAvatarSize(size); }}>
        <option value={160}>Pequeño</option><option value={220}>Mediano</option><option value={300}>Grande</option>
      </select>
    </label>
    {config?.nativeAgent && <label className="block text-sm">Esquina del avatar
      <select className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={corner} onChange={(e) => { const next = e.target.value as typeof corner; setCorner(next); void window.kaliDesktop!.setAvatarCorner(next); }}>
        <option value="bottom-right">Abajo derecha</option><option value="bottom-left">Abajo izquierda</option>
        <option value="top-right">Arriba derecha</option><option value="top-left">Arriba izquierda</option>
      </select>
    </label>}
    <button className="rounded-lg bg-accent px-4 py-2 text-bg" onClick={async () => {
      try { await window.kaliDesktop!.saveConfig({ mode, backendUrl, token, capabilityToken }); setMessage("Guardado. Recargando conexión…"); window.location.reload(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Error al guardar"); }
    }}>Guardar conexión</button>
    {message && <p className="text-xs" role="status">{message}</p>}
  </section>;
}
