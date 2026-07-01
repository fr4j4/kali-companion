// ConnectionsList — default view of the AI provider section.
//
// Renders the saved connections in two groups (Local / Cloud) and shows
// a banner when no provider is active.  The "+ Add" buttons open the
// form in create mode; per-card buttons call back to the parent for
// the corresponding action.

import { useTranslation } from "react-i18next";
import { Plus, AlertCircle } from "lucide-react";
import type { ConnectionSummary } from "../../../lib/protocol";
import { ConnectionCard } from "./ConnectionCard";

interface Props {
  connections: ConnectionSummary[];
  hasActiveProvider: boolean;
  onAdd: (kind: "local" | "cloud") => void;
  onEdit: (id: string) => void;
  onModels: (id: string) => void;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
  onDisconnect: (id: string) => void;
  onChangeModel?: (id: string) => void;
}

export function ConnectionsList({
  connections,
  hasActiveProvider,
  onAdd,
  onEdit,
  onModels,
  onActivate,
  onDelete,
  onDisconnect,
  onChangeModel,
}: Props) {
  const { t } = useTranslation();
  const local = connections.filter((c) => c.kind === "local");
  const cloud = connections.filter((c) => c.kind === "cloud");

  return (
    <div className="flex flex-col gap-5">
      {!hasActiveProvider && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warn/10 border border-warn/30">
          <AlertCircle size={14} className="text-warn shrink-0 mt-0.5" />
          <p className="text-xs text-warn leading-relaxed">
            {t("connections.no_active_provider")}
          </p>
        </div>
      )}

      <Group
        title={t("connections.local")}
        count={local.length}
        emptyText={t("connections.empty_local")}
        addLabel={t("connections.add_local")}
        onAdd={() => onAdd("local")}
      >
        {local.map((c) => (
          <ConnectionCard
            key={c.id}
            conn={c}
            onEdit={onEdit}
            onModels={onModels}
            onActivate={onActivate}
            onDelete={onDelete}
            onDisconnect={onDisconnect}
            onChangeModel={onChangeModel}
          />
        ))}
      </Group>

      <Group
        title={t("connections.cloud")}
        count={cloud.length}
        emptyText={t("connections.empty_cloud")}
        addLabel={t("connections.add_cloud")}
        onAdd={() => onAdd("cloud")}
      >
        {cloud.map((c) => (
          <ConnectionCard
            key={c.id}
            conn={c}
            onEdit={onEdit}
            onModels={onModels}
            onActivate={onActivate}
            onDelete={onDelete}
            onDisconnect={onDisconnect}
            onChangeModel={onChangeModel}
          />
        ))}
      </Group>
    </div>
  );
}

function Group({
  title,
  count,
  emptyText,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  count: number;
  emptyText: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wide">
          {title} <span className="text-muted/60">({count})</span>
        </h3>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={12} />
          {addLabel}
        </button>
      </div>
      {count === 0 ? (
        <p className="text-[11px] text-muted/60 px-3 py-3 rounded-lg bg-surface/40 border border-dashed border-border text-center">
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">{children}</div>
      )}
    </div>
  );
}