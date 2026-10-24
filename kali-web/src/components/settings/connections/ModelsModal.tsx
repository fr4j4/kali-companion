// ModelsModal — read-only list of models available on a connection.
//
// Probes the endpoint live so the user sees what's actually there right
// now, not just what was cached when the connection was saved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Loader2 } from "lucide-react";
import { Modal } from "../../ui/Modal";
import { testConnection } from "../../../lib/api/connections";
import type { ConnectionSummary } from "../../../lib/protocol";

interface Props {
  conn: ConnectionSummary | null;
  onClose: () => void;
}

export function ModelsModal({ conn, onClose }: Props) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[]>([]);
  const [vendor, setVendor] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!conn) return;
    setLoading(true);
    setError(null);
    setQuery("");
    void (async () => {
      try {
        const result = await testConnection(conn.api_url, "");
        if (result.ok) {
          setModels(result.models);
          setVendor(result.vendor);
        } else {
          setError(result.detail || t("connections.test_failed", { reason: "?" }));
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [conn, t]);

  if (!conn) return null;

  const filtered = query
    ? models.filter((m) => m.toLowerCase().includes(query.toLowerCase()))
    : models;

  return (
    <Modal open onClose={onClose} size="md" title={t("connections.models")}>
      <div className="flex flex-col h-full">
        <div className="shrink-0 flex flex-col gap-3">
          <div className="px-3 py-2.5 rounded-lg bg-surface border border-border">
            <div className="text-xs text-foreground font-medium">{conn.name}</div>
            <div className="text-[10px] text-muted font-mono mt-0.5">{conn.api_url}</div>
            {vendor && (
              <div className="text-[10px] text-muted/70 mt-1">{t("connections.vendor_detected", { vendor })}</div>
            )}
          </div>

          {models.length > 5 && (
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("provider.search_models") as string}
                className="w-full bg-surface text-foreground border border-border rounded-lg pl-7 pr-2.5 py-1.5 text-xs outline-none focus:border-accent-dim"
              />
            </div>
          )}

          {loading && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <Loader2 size={11} className="animate-spin" />
              {t("ai.loading_models")}
            </p>
          )}

          {error && <p className="text-[11px] text-err">{error}</p>}

          {!loading && !error && models.length === 0 && (
            <p className="text-[11px] text-muted/60 px-3 py-3 rounded-lg bg-surface/40 border border-dashed border-border text-center">
              {t("connections.test_ok_no_models")}
            </p>
          )}

          {!loading && filtered.length === 0 && models.length > 0 && (
            <p className="text-[11px] text-muted/60">{t("provider.no_models_match")}</p>
          )}
        </div>

        {!loading && filtered.length > 0 && (
          <div className="flex-1 overflow-y-auto min-h-0 stage-scroll mt-3">
            <div className="flex flex-col gap-1">
              {filtered.map((m) => (
                <div
                  key={m}
                  className="px-2.5 py-1.5 rounded-lg bg-surface border border-border text-[11px] font-mono text-foreground"
                >
                  {m}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}