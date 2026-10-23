import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopConfig } from "../lib/desktop";

export function DesktopConnectionSettings() {
  const { t } = useTranslation();
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
    <h3 className="font-semibold">{t("desktop.settings.title")}</h3>
    <p className="text-xs text-muted">{t("desktop.settings.scope")}</p>
    {config?.nativeAgent && <p className="text-xs text-muted" role="status">{t("desktop.settings.native_active")}</p>}
    <label className="block text-sm">{t("desktop.setup.mode")}
      <select className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={mode} onChange={(e) => setMode(e.target.value as "local" | "remote")}>
        <option value="local">{t("desktop.settings.local_mode")}</option><option value="remote">{t("desktop.setup.remote")}</option>
      </select>
    </label>
    {mode === "remote" && <>
    <label className="block text-sm">{t("desktop.settings.backend")}
      <input className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} />
    </label>
    <label className="block text-sm">{t("desktop.setup.token")}
      <input className="mt-1 w-full rounded-lg border border-border bg-bg p-2" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
    </label>
    <label className="block text-sm">{t("desktop.setup.capability_token")}
      <input className="mt-1 w-full rounded-lg border border-border bg-bg p-2" type="password" value={capabilityToken} onChange={(e) => setCapabilityToken(e.target.value)} autoComplete="off" />
    </label>
    </>}
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={showAvatar} onChange={async (e) => { setShowAvatar(e.target.checked); await window.kaliDesktop!.showAvatar(e.target.checked); }} /> {t("desktop.settings.show_avatar")}
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={showText} onChange={(e) => { setShowText(e.target.checked); localStorage.setItem("kali.desktop.showText", String(e.target.checked)); }} /> {t("desktop.settings.show_text")}
    </label>
    <label className="block text-sm">{t("desktop.settings.avatar_size")}
      <select className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={avatarSize} onChange={(e) => { const size = Number(e.target.value); setAvatarSize(size); void window.kaliDesktop!.setAvatarSize(size); }}>
        <option value={160}>{t("desktop.settings.size_small")}</option><option value={220}>{t("desktop.settings.size_medium")}</option><option value={300}>{t("desktop.settings.size_large")}</option>
      </select>
    </label>
    {config?.nativeAgent && <label className="block text-sm">{t("desktop.settings.corner")}
      <select className="mt-1 w-full rounded-lg border border-border bg-bg p-2" value={corner} onChange={(e) => { const next = e.target.value as typeof corner; setCorner(next); void window.kaliDesktop!.setAvatarCorner(next); }}>
        <option value="bottom-right">{t("desktop.settings.corner_bottom_right")}</option><option value="bottom-left">{t("desktop.settings.corner_bottom_left")}</option>
        <option value="top-right">{t("desktop.settings.corner_top_right")}</option><option value="top-left">{t("desktop.settings.corner_top_left")}</option>
      </select>
    </label>}
    <button className="rounded-lg bg-accent px-4 py-2 text-bg" onClick={async () => {
      try { await window.kaliDesktop!.saveConfig({ mode, backendUrl, token, capabilityToken }); setMessage(t("desktop.settings.saved") as string); window.location.reload(); }
      catch (error) { setMessage(error instanceof Error ? error.message : (t("desktop.settings.save_error") as string)); }
    }}>{t("desktop.settings.save")}</button>
    {message && <p className="text-xs" role="status">{message}</p>}
  </section>;
}
