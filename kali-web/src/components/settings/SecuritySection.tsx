// SecuritySection — API token client config (S1 companion UI).
//
// When the core has KALI_API_TOKEN set, every HTTP/WS call needs the token.
// The user pastes it here; it is stored in localStorage (kali.apiToken) and
// picked up by authHeaders() (http.ts) and WSClient (wsClient.ts). Changing
// it takes effect on the next page reload (WS reconnects on reload).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { SettingsCard } from "./SettingsCard";

const LS_KEY = "kali.apiToken";

export function SecuritySection() {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => localStorage.getItem(LS_KEY) || "");
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const trimmed = token.trim();
    if (trimmed) {
      localStorage.setItem(LS_KEY, trimmed);
    } else {
      localStorage.removeItem(LS_KEY);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    // Reload so the WS client reconnects carrying the auth challenge reply.
    setTimeout(() => window.location.reload(), 800);
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Lock}
        title={t("security.title", "Seguridad")}
        description={t(
          "security.description",
          "Token de acceso a la API de kali-core (KALI_API_TOKEN del server).",
        )}
      />

      <SettingsCard>
        <label className="text-xs font-medium text-muted" htmlFor="kali-api-token">
          {t("security.token_label", "Token de API")}
        </label>
        <div className="flex items-center gap-2 mt-1.5">
          <div className="relative flex-1">
            <input
              id="kali-api-token"
              type={visible ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="openssl rand -hex 32"
              autoComplete="off"
              spellCheck={false}
              className="w-full pr-10 px-3 py-2 text-sm font-mono rounded-lg bg-bg/60 border border-fg/10 focus:border-accent/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
              aria-label={visible ? "Hide token" : "Show token"}
            >
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            type="button"
            onClick={save}
            className="px-3 py-2 text-sm rounded-lg bg-accent/90 hover:bg-accent text-bg font-medium"
          >
            {saved
              ? t("security.saved", "Guardado ✓")
              : t("security.save", "Guardar")}
          </button>
        </div>
        <p className="text-xs text-muted leading-relaxed mt-2 flex items-start gap-1.5">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" />
          {t(
            "security.hint",
            "Déjalo vacío si el server no tiene auth activada. Cambia y recarga para aplicar.",
          )}
        </p>
      </SettingsCard>
    </div>
  );
}