import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Search, Server, Cloud } from "lucide-react";
import { Modal } from "../../ui/Modal";
import { testConnection } from "../../../lib/api/connections";
import type { ConnectionSummary } from "../../../lib/protocol";

interface Props {
  open: boolean;
  onClose: () => void;
  gameConnectionId: string | undefined;
  gameModel: string;
  connections: ConnectionSummary[];
  activeConnectionId: string | null;
  activeConnectionModel: string | null;
  onSave: (gameConnectionId: string, gameModel: string) => void;
}

export function GameConnectionPicker({
  open,
  onClose,
  gameConnectionId,
  gameModel,
  connections,
  activeConnectionId,
  activeConnectionModel,
  onSave,
}: Props) {
  const { t } = useTranslation();

  const [selectedConnId, setSelectedConnId] = useState<string>(gameConnectionId ?? "active");
  const [selectedModel, setSelectedModel] = useState<string>(gameModel);
  const [expandedConnId, setExpandedConnId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
  const [loadingConnId, setLoadingConnId] = useState<string | null>(null);
  const [probeErrors, setProbeErrors] = useState<Record<string, string>>({});
  const [modelQuery, setModelQuery] = useState("");

  const activeConnName = connections.find((c) => c.id === activeConnectionId)?.name ?? "Unknown";

  useEffect(() => {
    if (!open) return;
    setSelectedConnId(gameConnectionId ?? "active");
    setSelectedModel(gameModel);
    setExpandedConnId(null);
    setAvailableModels({});
    setProbeErrors({});
    setModelQuery("");
  }, [open, gameConnectionId, gameModel]);

  const handleConnToggle = async (connId: string) => {
    if (connId === "active") {
      setSelectedConnId("active");
      setSelectedModel(activeConnectionModel ?? "");
      setExpandedConnId(null);
      return;
    }

    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;

    setSelectedConnId(connId);

    if (availableModels[connId] || probeErrors[connId]) {
      setExpandedConnId(expandedConnId === connId ? null : connId);
      return;
    }

    setExpandedConnId(connId);
    setLoadingConnId(connId);

    try {
      const result = await testConnection(conn.api_url, "");
      if (result.ok) {
        setAvailableModels((prev) => ({ ...prev, [connId]: result.models }));
        const model = gameModel && result.models.includes(gameModel)
          ? gameModel
          : (result.models[0] ?? "");
        setSelectedModel(model);
      } else {
        setProbeErrors((prev) => ({ ...prev, [connId]: result.detail || t("connections.test_failed", { reason: "?" }) }));
      }
    } catch (err) {
      setProbeErrors((prev) => ({ ...prev, [connId]: (err as Error).message }));
    } finally {
      setLoadingConnId(null);
    }
  };

  const handleConfirm = () => {
    onSave(selectedConnId, selectedModel);
    onClose();
  };

  const filteredModels = useMemo(() => {
    if (!modelQuery.trim()) return availableModels[selectedConnId] ?? [];
    const q = modelQuery.toLowerCase();
    return (availableModels[selectedConnId] ?? []).filter((m) => m.toLowerCase().includes(q));
  }, [availableModels, selectedConnId, modelQuery]);

  const local = connections.filter((c) => c.kind === "local");
  const cloud = connections.filter((c) => c.kind === "cloud");
  const isExpanded = (id: string) => expandedConnId === id;
  const isLoading = (id: string) => loadingConnId === id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("settings.game_ai_title")}
      size="md"
    >
      <div className="flex flex-col gap-1">
        <ConnectionRow
          id="active"
          label={t("settings.game_ai_using_active")}
          sublabel={`${activeConnName}${activeConnectionModel ? ` → ${activeConnectionModel}` : ""}`}
          selected={selectedConnId === "active"}
          expanded={false}
          loading={false}
          error={null}
          models={[]}
          filteredModels={[]}
          selectedModel=""
          modelQuery=""
          onToggle={() => handleConnToggle("active")}
          onModelSelect={() => {}}
          onModelQueryChange={() => {}}
          gameConnectionId={gameConnectionId}
        />

        <div className="h-px bg-border my-2" />

        {local.map((conn) => (
          <ConnectionRow
            key={conn.id}
            id={conn.id}
            label={conn.name}
            sublabel={conn.api_url}
            kind={conn.kind}
            selected={selectedConnId === conn.id}
            expanded={isExpanded(conn.id)}
            loading={isLoading(conn.id)}
            error={probeErrors[conn.id] ?? null}
            models={availableModels[conn.id] ?? []}
            filteredModels={selectedConnId === conn.id ? filteredModels : []}
            selectedModel={selectedConnId === conn.id ? selectedModel : ""}
            modelQuery={selectedConnId === conn.id ? modelQuery : ""}
            onToggle={() => handleConnToggle(conn.id)}
            onModelSelect={setSelectedModel}
            onModelQueryChange={setModelQuery}
            gameConnectionId={gameConnectionId}
          />
        ))}

        {cloud.map((conn) => (
          <ConnectionRow
            key={conn.id}
            id={conn.id}
            label={conn.name}
            sublabel={conn.api_url}
            kind={conn.kind}
            selected={selectedConnId === conn.id}
            expanded={isExpanded(conn.id)}
            loading={isLoading(conn.id)}
            error={probeErrors[conn.id] ?? null}
            models={availableModels[conn.id] ?? []}
            filteredModels={selectedConnId === conn.id ? filteredModels : []}
            selectedModel={selectedConnId === conn.id ? selectedModel : ""}
            modelQuery={selectedConnId === conn.id ? modelQuery : ""}
            onToggle={() => handleConnToggle(conn.id)}
            onModelSelect={setSelectedModel}
            onModelQueryChange={setModelQuery}
            gameConnectionId={gameConnectionId}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-border">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors"
        >
          {t("connections.cancel")}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selectedModel || selectedConnId !== "active" && filteredModels.length === 0 && !probeErrors[selectedConnId ?? ""]}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors disabled:opacity-50"
        >
          {t("settings.game_ai_confirm")}
        </button>
      </div>
    </Modal>
  );
}

function ConnectionRow({
  id,
  label,
  sublabel,
  kind,
  selected,
  expanded,
  loading,
  error,
  models,
  filteredModels,
  selectedModel,
  modelQuery,
  onToggle,
  onModelSelect,
  onModelQueryChange,
  gameConnectionId,
}: {
  id: string;
  label: string;
  sublabel: string;
  kind?: "local" | "cloud";
  selected: boolean;
  expanded: boolean;
  loading: boolean;
  error: string | null;
  models: string[];
  filteredModels: string[];
  selectedModel: string;
  modelQuery: string;
  onToggle: () => void;
  onModelSelect: (model: string) => void;
  onModelQueryChange: (q: string) => void;
  gameConnectionId: string | undefined;
}) {
  const { t } = useTranslation();
  const Icon = kind === "cloud" ? Cloud : Server;

  return (
    <div className="flex flex-col">
      <button
        onClick={onToggle}
        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors text-left w-full ${
          selected
            ? "border-accent/40 bg-accent/5"
            : "border-transparent hover:border-border"
        }`}
      >
        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
          selected ? "border-accent" : "border-muted"
        }`}>
          {selected && <div className="w-2 h-2 rounded-full bg-accent" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {kind && <Icon size={12} className="text-muted shrink-0" />}
            <span className="text-xs font-medium text-foreground truncate">{label}</span>
            {id !== "active" && gameConnectionId === id && (
              <span className="text-[10px] font-mono bg-accent/20 text-accent rounded px-1.5 py-0.5 shrink-0">
                {t("connections.games_badge")}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted font-mono mt-0.5 truncate">{sublabel}</div>
        </div>

        {id !== "active" && (
          <div className="shrink-0">
            {loading ? (
              <div className="w-4 h-4 border-2 border-muted border-t-accent rounded-full animate-spin" />
            ) : expanded ? (
              <ChevronUp size={14} className="text-muted" />
            ) : (
              <ChevronDown size={14} className="text-muted" />
            )}
          </div>
        )}
      </button>

      {expanded && id !== "active" && (
        <div className="flex flex-col gap-2 pl-8 pr-3 pb-3 mt-1">
          {loading && (
            <p className="text-[11px] text-muted py-1">{t("ai.loading_models")}</p>
          )}

          {error && (
            <p className="text-[11px] text-err py-1">{error}</p>
          )}

          {!loading && !error && models.length > 0 && (
            <>
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  value={modelQuery}
                  onChange={(e) => onModelQueryChange(e.target.value)}
                  placeholder={t("connections.search_models", { defaultValue: "Search…" })}
                  className="w-full bg-surface text-foreground border border-border rounded-md pl-6 pr-2 py-1 text-[11px] outline-none focus:border-accent-dim"
                />
              </div>

              <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto stage-scroll">
                {filteredModels.map((m) => {
                  const isSelected = selectedModel === m;
                  return (
                    <button
                      key={m}
                      onClick={() => onModelSelect(m)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border text-left transition-colors ${
                        isSelected
                          ? "border-accent/40 bg-accent/10"
                          : "border-border bg-surface hover:border-accent/30"
                      }`}
                    >
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        isSelected ? "border-accent" : "border-muted"
                      }`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                      </div>
                      <span className="text-[11px] font-mono text-foreground truncate">{m}</span>
                    </button>
                  );
                })}
                {filteredModels.length === 0 && (
                  <p className="text-[10px] text-muted/60 text-center py-2">
                    {t("connections.no_models_match")}
                  </p>
                )}
              </div>
            </>
          )}

          {!loading && !error && models.length === 0 && (
            <p className="text-[11px] text-muted py-1">{t("connections.test_ok_no_models")}</p>
          )}
        </div>
      )}
    </div>
  );
}
