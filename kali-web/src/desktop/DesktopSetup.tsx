import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopConnectionConfig } from "../lib/desktop";

function SecretInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return <label className="block text-sm">{label}
    <span className="mt-2 flex gap-2">
      <input className="w-full rounded-lg border border-border bg-bg p-3" type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      <button type="button" className="shrink-0 rounded-lg border border-border px-3 text-xs text-muted hover:text-fg" aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        {shown ? t("desktop.setup.hide_secret") : t("desktop.setup.show_secret")}
      </button>
    </span>
  </label>;
}

export function DesktopSetup({ initial }: { initial: DesktopConnectionConfig }) {
  const { t } = useTranslation();
  const [backendUrl, setBackendUrl] = useState(initial.backendUrl);
  const [token, setToken] = useState(initial.token);
  const [capabilityToken, setCapabilityToken] = useState(initial.capabilityToken);
  const [mode, setMode] = useState<"local" | "remote">(initial.mode || "remote");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test">("");

  /** Persist the config and wait for /health; returns the round-trip time in ms. */
  async function connect(): Promise<number> {
    await window.kaliDesktop!.saveConfig({ mode, backendUrl, token, capabilityToken });
    const started = performance.now();
    let response = await fetch("/health").catch(() => null);
    // A local kali-core needs a few seconds to boot.
    for (let i = 0; mode === "local" && (!response || !response.ok) && i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      response = await fetch("/health").catch(() => null);
    }
    if (!response) throw new Error(t("desktop.setup.err_unreachable") as string);
    if (!response.ok) throw new Error(t("desktop.setup.err_status", { status: response.status }) as string);
    return Math.round(performance.now() - started);
  }

  async function run(kind: "save" | "test") {
    setBusy(kind); setError(""); setInfo("");
    try {
      const ms = await connect();
      if (kind === "save") { window.location.reload(); return; }
      setInfo(t("desktop.setup.test_ok", { ms }) as string);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : (t("desktop.setup.err_connect") as string));
    }
    setBusy("");
  }

  const card = (id: "local" | "remote") => <button type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
    className={`rounded-lg border p-3 text-left ${mode === id ? "border-accent" : "border-border"}`}>
    <b>{t(`desktop.setup.${id}`)}</b><br /><span className="text-muted">{t(`desktop.setup.${id}_hint`)}</span>
  </button>;

  return <main className="min-h-screen flex items-center justify-center bg-bg text-fg p-6">
    <div className="w-full max-w-lg rounded-2xl border border-border bg-elevated p-6 space-y-5">
      <h1 className="text-2xl font-semibold">{t("desktop.setup.title")}</h1>
      <p className="text-sm text-muted">{t("desktop.setup.intro")}</p>
      <div className="grid grid-cols-2 gap-2 text-sm" role="radiogroup" aria-label={t("desktop.setup.mode") as string}>
        {card("local")}{card("remote")}
      </div>
      {mode === "remote" && <>
      <label className="block text-sm">{t("desktop.setup.backend_url")}
        <input className="mt-2 w-full rounded-lg border border-border bg-bg p-3" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="https://companion.local:8444" />
      </label>
      <SecretInput label={t("desktop.setup.token") as string} value={token} onChange={setToken} />
      <SecretInput label={t("desktop.setup.capability_token") as string} value={capabilityToken} onChange={setCapabilityToken} />
      </>}
      {error && <p className="text-sm text-err" role="alert">{error}</p>}
      {info && <p className="text-sm text-ok" role="status">{info}</p>}
      <div className="flex gap-2">
        <button className="rounded-lg border border-border px-4 py-3 text-sm disabled:opacity-50" disabled={!!busy || (mode === "remote" && !backendUrl)} onClick={() => run("test")}>
          {busy === "test" ? t("desktop.setup.testing") : t("desktop.setup.test")}
        </button>
        <button className="flex-1 rounded-lg bg-accent p-3 text-bg font-semibold disabled:opacity-50" disabled={!!busy || (mode === "remote" && !backendUrl)} onClick={() => run("save")}>
          {busy === "save" ? t("desktop.setup.connecting") : t("desktop.setup.connect")}
        </button>
      </div>
    </div>
  </main>;
}
