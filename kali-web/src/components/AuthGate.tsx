// AuthGate — login modal shown when the core has KALI_API_TOKEN enabled but
// the browser has no token saved (or the saved one is wrong).
//
// Flow: WS receives {event: "auth_required"} → core emits a global event →
// AuthGate opens. The user pastes the token (same value as the server's
// KALI_API_TOKEN); it is stored in localStorage (kali.apiToken) and the page
// reloads so WSClient + authHeaders pick it up everywhere.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { Overlay } from "../components/ui/Overlay";

const LS_KEY = "kali.apiToken";
export const AUTH_REQUIRED_EVT = "kali:auth-required";

export function readApiToken(): string {
  return localStorage.getItem(LS_KEY) || "";
}

export function AuthGate() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const handler = () => {
      setError(readApiToken() !== "");
      setOpen(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVT, handler);
    return () => window.removeEventListener(AUTH_REQUIRED_EVT, handler);
  }, []);

  const submit = () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError(true);
      return;
    }
    localStorage.setItem(LS_KEY, trimmed);
    window.location.reload();
  };

  if (!open) return null;

  return (
    <Overlay open={true} onClose={() => {}} bare={true}>
      <div
        className="w-full max-w-md mx-4 rounded-2xl border border-fg/10 bg-bg p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Token requerido"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-accent/15 text-accent">
            <Lock size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {t("authgate.title", "Acceso protegido")}
            </h2>
            <p className="text-xs text-muted">
              {t("authgate.subtitle", "Este servidor requiere un token de API")}
            </p>
          </div>
        </div>

        {error && (
          <p className="mb-3 text-xs text-err">
            {t(
              "authgate.wrong_token",
              "El token guardado no fue aceptado. Ingresa el correcto (KALI_API_TOKEN del server).",
            )}
          </p>
        )}

        <label className="text-xs font-medium text-muted" htmlFor="authgate-token">
          {t("security.token_label", "Token de API")}
        </label>
        <div className="relative mt-1.5">
          <input
            id="authgate-token"
            autoFocus
            type={visible ? "text" : "password"}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="openssl rand -hex 32"
            autoComplete="off"
            spellCheck={false}
            className={`w-full pr-10 px-3 py-2 text-sm font-mono rounded-lg bg-bg/60 border focus:outline-none ${
              error ? "border-err/70" : "border-fg/10 focus:border-accent/60"
            }`}
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
          onClick={submit}
          className="mt-4 w-full px-3 py-2 text-sm rounded-lg bg-accent/90 hover:bg-accent text-bg font-medium"
        >
          {t("authgate.connect", "Conectar")}
        </button>

        <p className="mt-3 text-[11px] text-muted leading-relaxed flex items-start gap-1.5">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent" />
          {t(
            "authgate.hint",
            "El token viaja por HTTPS y se guarda solo en este navegador (localStorage).",
          )}
        </p>
      </div>
    </Overlay>
  );
}