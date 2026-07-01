import { useTranslation } from "react-i18next";
import { Edit2, ListChecks, Star, Trash2, Server, Cloud, Pencil, X } from "lucide-react";
import type { ConnectionSummary } from "../../../lib/protocol";

interface Props {
  conn: ConnectionSummary;
  onEdit: (id: string) => void;
  onModels: (id: string) => void;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onChangeModel?: (id: string) => void;
}

export function ConnectionCard({ conn, onEdit, onModels, onActivate, onDelete, onDisconnect, onChangeModel }: Props) {
  const { t } = useTranslation();
  const Icon = conn.kind === "local" ? Server : Cloud;
  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg bg-surface transition-colors ${
        conn.is_active
          ? "border-2 border-accent/40 bg-accent/5"
          : "border border-border hover:border-accent/30"
      }`}
    >
      <Icon size={16} className={`mt-0.5 ${conn.is_active ? "text-ok" : "text-muted"}`} />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground font-medium truncate">
            {conn.name}
          </span>
          {conn.is_active && (
            <span className="text-[10px] font-mono bg-ok/20 text-ok rounded px-1.5 py-0.5 shrink-0">
              {t("connections.active_badge")}
            </span>
          )}
        </div>
        <div className="text-[10px] font-mono text-muted/80 break-all leading-relaxed">
          {conn.api_url}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted/80">
          <span>{conn.vendor_detected || conn.api_format}</span>
          <span>·</span>
          <span>{t("ai.models", { defaultValue: "models" })}: {conn.model_count}</span>
          {conn.is_active && conn.active_model && (
            <>
              <span>·</span>
              {onChangeModel ? (
                <button
                  onClick={() => onChangeModel(conn.id)}
                  className="flex items-center gap-1 text-accent hover:text-accent-dim transition-colors cursor-pointer"
                  title={t("connections.change_model")}
                >
                  {conn.active_model}
                  <Pencil size={10} />
                </button>
              ) : (
                <span className="text-accent">{conn.active_model}</span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        <button
          onClick={() => onEdit(conn.id)}
          className="p-1.5 rounded-md text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          title={t("connections.edit")}
          aria-label={t("connections.edit")}
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={() => onModels(conn.id)}
          className="p-1.5 rounded-md text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          title={t("connections.models")}
          aria-label={t("connections.models")}
        >
          <ListChecks size={13} />
        </button>
        <button
          onClick={() => onDelete(conn.id)}
          className="p-1.5 rounded-md text-muted hover:text-err hover:bg-err/10 transition-colors"
          title={t("connections.delete")}
          aria-label={t("connections.delete")}
        >
          <Trash2 size={13} />
        </button>
        {conn.is_active ? (
          <button
            onClick={() => onDisconnect?.(conn.id)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium text-err hover:bg-err/10 transition-colors"
          >
            <X size={12} />
            {t("connections.disconnect")}
          </button>
        ) : (
          <button
            onClick={() => onActivate(conn.id)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
          >
            <Star size={12} />
            {t("connections.set_active")}
          </button>
        )}
      </div>
    </div>
  );
}
