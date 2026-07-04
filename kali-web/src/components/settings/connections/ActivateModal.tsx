import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Star, Pencil, Cloud, Server, XCircle } from "lucide-react";
import { Modal } from "../../ui/Modal";
import { testConnection } from "../../../lib/api/connections";
import type { ConnectionSummary } from "../../../lib/protocol";

type HealthStatus = "checking" | "online" | "offline";

interface Props {
  conn: ConnectionSummary | null;
  onClose: () => void;
  onActivate: (id: string, model: string) => Promise<void> | void;
}

export function ActivateModal({ conn, onClose, onActivate }: Props) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[]>([]);
  const [vendor, setVendor] = useState<string>("");
  const [health, setHealth] = useState<HealthStatus>("checking");
  const [probeError, setProbeError] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!conn) return;
    setModel("");
    setQuery("");
    setProbeError(null);
    setHealth("checking");
    setModels([]);
    setVendor("");

    void (async () => {
      try {
        const result = await testConnection(conn.api_url, "", conn.id);
        if (result.ok) {
          setModels(result.models);
          setVendor(result.vendor);
          setHealth("online");
          if (result.models.length > 0) {
            setModel((curr) => curr || result.models[0]);
          }
        } else {
          setProbeError(result.detail || t("connections.test_failed", { reason: "?" }));
          setHealth("offline");
        }
      } catch (err) {
        setProbeError((err as Error).message);
        setHealth("offline");
      }
    })();
  }, [conn, t]);

  const filteredModels = useMemo(() => {
    if (!query.trim()) return models;
    const q = query.toLowerCase();
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, query]);

  if (!conn) return null;

  const handleSubmit = async () => {
    if (!model.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onActivate(conn.id, model.trim());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const isChangeModel = conn.is_active;

  const healthColor =
    health === "online" ? "text-ok" : health === "offline" ? "text-err" : "text-warn";
  const healthBg =
    health === "online" ? "bg-ok/20" : health === "offline" ? "bg-err/20" : "bg-warn/20";

  const Icon = conn.kind === "cloud" ? Cloud : Server;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={isChangeModel ? t("connections.change_model_title") : t("connections.activate_title")}
      bare={true}
      panelClassName="max-h-[70vh]"
    >
      <div className="flex flex-col h-full p-5 gap-4">
        <div
          className={`flex flex-col rounded-xl border transition-all overflow-hidden shrink-0 ${
            health === "offline" ? "border-err/30 bg-err/5" : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <Icon size={15} className="text-muted shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{conn.name}</span>
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${healthBg} ${healthColor}`}>
                  {health === "checking" && (
                    <div className="w-2 h-2 rounded-full border border-current animate-pulse" />
                  )}
                  {health === "online" && <div className="w-2 h-2 rounded-full bg-current" />}
                  {health === "offline" && <XCircle size={10} className="text-current" />}
                  <span>
                    {health === "checking"
                      ? t("settings.game_ai_checking")
                      : health === "online"
                      ? t("settings.game_ai_online")
                      : t("settings.game_ai_offline")}
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-muted font-mono mt-0.5 truncate">{conn.api_url}</div>
            </div>
          </div>

          {health === "offline" && (
            <div className="px-3 pb-3 pt-1 border-t border-border/30">
              <p className="text-[11px] text-err flex items-center gap-1.5">
                <XCircle size={12} />
                {probeError || t("settings.game_ai_connection_failed")}
              </p>
            </div>
          )}
        </div>

        {isChangeModel && health === "online" && models.length > 0 && (
          <p className="text-[11px] text-muted/80 shrink-0">{t("connections.change_model_subtitle")}</p>
        )}

        {!isChangeModel && health === "online" && models.length > 0 && (
          <p className="text-[11px] text-muted/80 shrink-0">{t("connections.activate_subtitle")}</p>
        )}

        {health === "checking" && (
          <div className="text-[11px] text-muted flex items-center gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full border border-muted border-t-accent animate-spin" />
            {t("ai.loading_models")}
          </div>
        )}

        {health === "online" && models.length > 0 && (
          <>
            <div className="flex flex-col gap-2">
              <div className="text-[10px] text-muted uppercase tracking-wide">
                {t("settings.game_ai_select_model")}
              </div>

              <div className="relative">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                >
                  <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8.5 8.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("connections.search_models", { defaultValue: "Search…" })}
                  className="w-full bg-surface text-foreground border border-border rounded-lg pl-8 pr-2.5 py-2 text-xs outline-none focus:border-accent/60 transition-colors"
                />
              </div>

              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto stage-scroll">
                {filteredModels.map((m) => {
                  const selected = model === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setModel(m)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                        selected
                          ? "border-accent/50 bg-accent/10"
                          : "border-muted/20 bg-surface/50 hover:border-accent/40"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                          selected ? "border-accent bg-accent" : "border-muted/25"
                        }`}
                      >
                        {selected && <div className="w-1.5 h-1.5 rounded-full bg-foreground" />}
                      </div>
                      <span className="text-xs font-mono text-foreground truncate leading-relaxed">{m}</span>
                    </button>
                  );
                })}
                {filteredModels.length === 0 && (
                  <div className="py-4 text-center">
                    <p className="text-xs text-muted">{t("connections.no_models_match")}</p>
                  </div>
                )}
              </div>
            </div>

            {vendor && (
              <p className="text-[10px] text-muted/60">
                {t("connections.vendor_detected", { vendor })}
              </p>
            )}
          </>
        )}

        {health === "online" && models.length === 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-muted">{t("ai.model")}</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("ai.model_placeholder") as string}
              className="bg-surface text-foreground border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-accent/60 transition-colors"
            />
            <p className="text-[10px] text-muted/60">{t("connections.test_ok_no_models")}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/30 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          >
            {t("connections.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!model.trim() || submitting || health === "checking" || health === "offline"}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isChangeModel ? <Pencil size={12} /> : <Star size={12} />}
            {isChangeModel ? t("connections.change_model_btn") : t("connections.set_active")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
