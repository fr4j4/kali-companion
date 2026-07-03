// ProviderSection — AI provider management.
//
// Redesign: shows a list of saved connections (Local / Cloud) instead of
// a single mutable form.  Changes only apply when the user presses
// Save / Set as active.  Tab switches (Local ↔ Cloud) only change the
// visible form, never the backend state — the original "every keystroke
// reconfigures Kali" bug is fixed by construction.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu } from "lucide-react";
import type { StatusEvent } from "../../lib/protocol";
import { useStage } from "../../stage/StageProvider";
import { SectionHeader } from "./SectionHeader";
import { SettingsCard } from "./SettingsCard";
import { ConnectionsList } from "./connections/ConnectionsList";
import { ConnectionForm } from "./connections/ConnectionForm";
import { ActivateModal } from "./connections/ActivateModal";
import { ModelsModal } from "./connections/ModelsModal";
import { deleteConnection, listConnections, testConnection } from "../../lib/api/connections";
import type { ConnectionKind, ConnectionSummary } from "../../lib/protocol";

type HealthStatus = "checking" | "online" | "offline";

type FormMode = "create" | "edit";
type FormKind = ConnectionKind;

interface FormState {
  open: boolean;
  mode: FormMode;
  kind: FormKind;
  existingId: string | null;
}

const EMPTY_FORM: FormState = { open: false, mode: "create", kind: "local", existingId: null };

interface Props {
  systemStatus: StatusEvent | null;
}

export function ProviderSection({ systemStatus }: Props) {
  const { t } = useTranslation();
  const { connections, activeConnectionId, cloudProviders, activateConnection, deactivateConnection, refreshConnections } = useStage();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [activateConn, setActivateConn] = useState<ConnectionSummary | null>(null);
  const [modelsConn, setModelsConn] = useState<ConnectionSummary | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, HealthStatus>>({});

  useEffect(() => {
    const results: Record<string, HealthStatus> = {};
    for (const conn of connections) {
      results[conn.id] = "checking";
    }
    setHealth(results);

    void Promise.all(
      connections.map(async (conn) => {
        try {
          const result = await testConnection(conn.api_url, "");
          setHealth((prev) => ({
            ...prev,
            [conn.id]: result.ok ? "online" : "offline",
          }));
        } catch {
          setHealth((prev) => ({ ...prev, [conn.id]: "offline" }));
        }
      }),
    );
  }, [connections]);

  const handleAdd = (kind: FormKind) =>
    setForm({ open: true, mode: "create", kind, existingId: null });

  const handleEdit = (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    setForm({
      open: true,
      mode: "edit",
      kind: conn.kind as ConnectionKind,
      existingId: id,
    });
  };

  const handleFormSaved = async (_conn: ConnectionSummary) => {
    setForm(EMPTY_FORM);
    await refreshConnections();
    // Notify any other consumers (other open modals, etc.) that the list changed.
    window.dispatchEvent(new CustomEvent("refresh-connections"));
  };

  const handleActivate = (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    setActivateConn(conn);
  };

  const handleModels = (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    setModelsConn(conn);
  };

  const handleDisconnect = (_id: string) => {
    deactivateConnection();
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      // Auto-clear the confirmation after a few seconds.
      setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteConnection(id);
      await refreshConnections();
      window.dispatchEvent(new CustomEvent("refresh-connections"));
    } catch {
      // The next status event will refresh state anyway; no toast plumbing here.
    }
  };

  const existing = form.existingId
    ? connections.find((c) => c.id === form.existingId) ?? null
    : null;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Cpu}
        title={t("connections.title")}
        description={t("connections.description")}
      />

      <SettingsCard>
        {form.open ? (
          <ConnectionForm
            mode={form.mode}
            kind={form.kind}
            existing={existing}
            cloudProviders={cloudProviders}
            onSaved={handleFormSaved}
            onCancel={() => setForm(EMPTY_FORM)}
          />
        ) : (
          <ConnectionsList
            connections={connections}
            hasActiveProvider={activeConnectionId !== null}
            onAdd={handleAdd}
            onEdit={handleEdit}
            onModels={handleModels}
            onActivate={handleActivate}
            onChangeModel={handleActivate}
            onDelete={handleDelete}
            onDisconnect={handleDisconnect}
            gameConnectionId={systemStatus?.game_connection_id}
            health={health}
          />
        )}
      </SettingsCard>

      <ActivateModal
        conn={activateConn}
        onClose={() => setActivateConn(null)}
        onActivate={async (id, model) => {
          await activateConnection(id, model);
        }}
      />

      <ModelsModal conn={modelsConn} onClose={() => setModelsConn(null)} />

      {confirmDeleteId && (
        <ConfirmDelete
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => handleDelete(confirmDeleteId)}
        />
      )}
    </div>
  );
}

function ConfirmDelete({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55">
      <div className="bg-elevated border border-border rounded-xl shadow-xl w-[min(360px,90vw)] p-4 flex flex-col gap-3">
        <p className="text-sm text-foreground">{t("connections.confirm_delete")}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          >
            {t("connections.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md border border-err bg-err/15 text-err text-xs font-medium hover:bg-err/25 transition-colors"
          >
            {t("connections.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// `listConnections` import is kept for potential future use (e.g. optimistic
// updates without waiting for the WS status event).  Suppress the unused
// warning by re-exporting it.
export { listConnections };