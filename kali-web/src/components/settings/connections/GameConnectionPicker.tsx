import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Circle, Server, Cloud, CheckCircle, XCircle } from "lucide-react";
import { Modal } from "../../ui/Modal";
import { testConnection } from "../../../lib/api/connections";
import type { ConnectionSummary } from "../../../lib/protocol";

type HealthStatus = "idle" | "checking" | "online" | "offline";

interface HealthState {
  status: HealthStatus;
  models: string[];
  error: string | null;
}

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
  const [health, setHealth] = useState<Record<string, HealthState>>({});
  const [modelQuery, setModelQuery] = useState("");

  const activeConnName = connections.find((c) => c.id === activeConnectionId)?.name ?? "Unknown";

  useEffect(() => {
    if (!open) return;
    setSelectedConnId(gameConnectionId ?? "active");
    setSelectedModel(gameModel);
    setExpandedConnId(null);
    setHealth({});
    setModelQuery("");
  }, [open, gameConnectionId, gameModel]);

  useEffect(() => {
    if (!open) return;
    void checkAllConnections();
  }, [open]);

  const checkAllConnections = async () => {
    const results: Record<string, HealthState> = {};
    for (const conn of connections) {
      results[conn.id] = { status: "checking", models: [], error: null };
    }
    setHealth(results);

    await Promise.all(
      connections.map(async (conn) => {
        try {
          const result = await testConnection(conn.api_url, "");
          if (result.ok) {
            setHealth((prev) => ({
              ...prev,
              [conn.id]: { status: "online", models: result.models, error: null },
            }));
          } else {
            setHealth((prev) => ({
              ...prev,
              [conn.id]: { status: "offline", models: [], error: result.detail ?? "Connection failed" },
            }));
          }
        } catch (err) {
          setHealth((prev) => ({
            ...prev,
            [conn.id]: { status: "offline", models: [], error: (err as Error).message },
          }));
        }
      }),
    );
  };

  const handleConnToggle = (connId: string) => {
    if (connId === "active") {
      setSelectedConnId("active");
      setSelectedModel(activeConnectionModel ?? "");
      setExpandedConnId(null);
      return;
    }

    const connHealth = health[connId];
    if (!connHealth || connHealth.status === "checking") return;

    setSelectedConnId(connId);

    if (expandedConnId === connId) {
      setExpandedConnId(null);
      return;
    }

    setExpandedConnId(connId);

    if (connHealth.models.length > 0) {
      setSelectedModel((curr) =>
        curr && connHealth.models.includes(curr) ? curr : (connHealth.models[0] ?? ""),
      );
    } else {
      setSelectedModel(gameModel || "");
    }
  };

  const handleConfirm = () => {
    onSave(selectedConnId, selectedModel);
    onClose();
  };

  const filteredModels = useMemo(() => {
    const models = expandedConnId ? (health[expandedConnId]?.models ?? []) : [];
    if (!modelQuery.trim()) return models;
    const q = modelQuery.toLowerCase();
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [health, expandedConnId, modelQuery]);

  const local = connections.filter((c) => c.kind === "local");
  const cloud = connections.filter((c) => c.kind === "cloud");

  return (
    <Modal open={open} onClose={onClose} title={t("settings.game_ai_title")} size="md">
      <div className="flex flex-col gap-2">
        <ActiveConnectionCard
          activeConnectionModel={activeConnectionModel}
          selected={selectedConnId === "active"}
          onSelect={() => handleConnToggle("active")}
          gameConnectionId={gameConnectionId}
          activeConnName={activeConnName}
        />

        <div className="h-px bg-border" />

        <div className="flex flex-col gap-1.5">
          {local.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              health={health[conn.id]}
              selected={selectedConnId === conn.id}
              expanded={expandedConnId === conn.id}
              selectedModel={selectedConnId === conn.id ? selectedModel : ""}
              modelQuery={expandedConnId === conn.id ? modelQuery : ""}
              onToggle={() => handleConnToggle(conn.id)}
              onModelSelect={setSelectedModel}
              onModelQueryChange={setModelQuery}
              gameConnectionId={gameConnectionId}
            />
          ))}

          {cloud.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              health={health[conn.id]}
              selected={selectedConnId === conn.id}
              expanded={expandedConnId === conn.id}
              selectedModel={selectedConnId === conn.id ? selectedModel : ""}
              modelQuery={expandedConnId === conn.id ? modelQuery : ""}
              onToggle={() => handleConnToggle(conn.id)}
              onModelSelect={setSelectedModel}
              onModelQueryChange={setModelQuery}
              gameConnectionId={gameConnectionId}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 mt-3 border-t border-border">
        <button
          onClick={checkAllConnections}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          title={t("connections.test")}
        >
          <Circle
            size={10}
            fill="currentColor"
            className={
              Object.values(health).some((h) => h.status === "checking")
                ? "text-warn animate-pulse"
                : Object.values(health).some((h) => h.status === "offline")
                ? "text-err"
                : "text-ok"
            }
          />
          {t("settings.game_ai_check_connections")}
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs text-muted hover:text-foreground hover:bg-white/5 transition-colors"
          >
            {t("connections.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              !selectedModel ||
              (selectedConnId !== "active" &&
                (health[selectedConnId]?.status === "offline" ||
                  (filteredModels.length === 0 && health[selectedConnId]?.status === "online")))
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle size={12} />
            {t("settings.game_ai_confirm")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ActiveConnectionCard({
  activeConnectionModel,
  selected,
  onSelect,
  gameConnectionId,
  activeConnName,
}: {
  activeConnectionModel: string | null;
  selected: boolean;
  onSelect: () => void;
  gameConnectionId: string | undefined;
  activeConnName: string;
}) {
  const { t } = useTranslation();

  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left w-full group ${
        selected
          ? "border-accent/50 bg-accent/8 shadow-sm"
          : "border-border bg-surface hover:border-accent/30"
      }`}
    >
      <div
        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
          selected ? "border-accent bg-accent" : "border-muted group-hover:border-muted/70"
        }`}
      >
        {selected && (
          <CheckCircle size={10} fill="currentColor" className="text-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {t("settings.game_ai_using_active")}
          </span>
          {gameConnectionId === "active" && (
            <span className="text-[10px] font-mono bg-accent/20 text-accent rounded px-1.5 py-0.5">
              {t("connections.games_badge")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted truncate">
            {activeConnectionModel
              ? `${activeConnName} → ${activeConnectionModel}`
              : activeConnName}
          </span>
        </div>
      </div>

      <div className="shrink-0">
        {activeConnectionModel ? (
          <CheckCircle size={16} className="text-ok" fill="currentColor" />
        ) : (
          <Circle size={16} className="text-muted" />
        )}
      </div>
    </button>
  );
}

function ConnectionCard({
  conn,
  health,
  selected,
  expanded,
  selectedModel,
  modelQuery,
  onToggle,
  onModelSelect,
  onModelQueryChange,
  gameConnectionId,
}: {
  conn: ConnectionSummary;
  health?: HealthState;
  selected: boolean;
  expanded: boolean;
  selectedModel: string;
  modelQuery: string;
  onToggle: () => void;
  onModelSelect: (model: string) => void;
  onModelQueryChange: (q: string) => void;
  gameConnectionId: string | undefined;
}) {
  const { t } = useTranslation();
  const Icon = conn.kind === "cloud" ? Cloud : Server;

  const filteredModels = useMemo(() => {
    const models = health?.models ?? [];
    if (!modelQuery.trim()) return models;
    const q = modelQuery.toLowerCase();
    return models.filter((m: string) => m.toLowerCase().includes(q));
  }, [health?.models, modelQuery]);

  const healthColor =
    health?.status === "online"
      ? "text-ok"
      : health?.status === "offline"
      ? "text-err"
      : health?.status === "checking"
      ? "text-warn"
      : "text-muted";

  const healthBg =
    health?.status === "online"
      ? "bg-ok/20"
      : health?.status === "offline"
      ? "bg-err/20"
      : health?.status === "checking"
      ? "bg-warn/20"
      : "bg-muted/20";

  const canExpand = health?.status === "online" || health?.status === "idle";
  const isDisabled = health?.status === "checking" || health?.status === "offline";

  return (
    <div
      className={`flex flex-col rounded-xl border transition-all overflow-hidden group ${
        selected
          ? "border-accent/50 bg-accent/8"
          : isDisabled
          ? "border-border bg-surface/50 opacity-60"
          : "border-border bg-surface hover:border-accent/20"
      }`}
    >
      <button
        onClick={onToggle}
        disabled={isDisabled}
        className={`flex items-center gap-3 px-3 py-3 text-left w-full ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div
          className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
            selected
              ? "border-accent bg-accent"
              : isDisabled
              ? "border-muted/40"
              : "border-muted group-hover:border-muted/70"
          }`}
          style={!selected && !isDisabled ? { borderColor: "var(--color-muted)" } : undefined}
        >
          {selected && <CheckCircle size={10} fill="currentColor" className="text-white" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={13} className="text-muted shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{conn.name}</span>
            {gameConnectionId === conn.id && (
              <span className="text-[10px] font-mono bg-accent/20 text-accent rounded px-1.5 py-0.5 shrink-0">
                {t("connections.games_badge")}
              </span>
            )}
            {conn.id === conn.id && health?.status === "online" && (
              <span className="text-[10px] text-ok/80">· {health.models.length} models</span>
            )}
          </div>
          <div className="text-[11px] text-muted font-mono mt-0.5 truncate">{conn.api_url}</div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${healthBg} ${healthColor}`}>
            {health?.status === "checking" && (
              <div className="w-2 h-2 rounded-full border border-current animate-pulse" />
            )}
            {health?.status === "online" && <div className="w-2 h-2 rounded-full bg-current" />}
            {health?.status === "offline" && <XCircle size={10} fill="currentColor" />}
            {health?.status === "idle" && <div className="w-2 h-2 rounded-full border border-current" />}
            <span>
              {health?.status === "checking"
                ? t("settings.game_ai_checking")
                : health?.status === "online"
                ? t("settings.game_ai_online")
                : health?.status === "offline"
                ? t("settings.game_ai_offline")
                : t("settings.game_ai_unknown")}
            </span>
          </div>

          {canExpand && (
            <div className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-muted">
                <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      </button>

      {expanded && canExpand && health && (
        <div className="flex flex-col gap-2 px-3 pb-3 border-t border-border/50">
          <div className="pt-2">
            <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5">
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
                value={modelQuery}
                onChange={(e) => onModelQueryChange(e.target.value)}
                placeholder={t("connections.search_models", { defaultValue: "Search…" })}
                className="w-full bg-background text-foreground border border-border rounded-lg pl-8 pr-2.5 py-2 text-xs outline-none focus:border-accent/60 transition-colors"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto stage-scroll">
            {filteredModels.map((m) => {
              const isSelected = selectedModel === m;
              return (
                <button
                  key={m}
                  onClick={() => onModelSelect(m)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors text-left ${
                    isSelected
                      ? "border-accent/50 bg-accent/10"
                      : "border-border/50 bg-background hover:border-accent/30"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      isSelected ? "border-accent bg-accent" : "border-muted/40"
                    }`}
                  >
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <span className="text-xs font-mono text-foreground truncate">{m}</span>
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
      )}

      {expanded && health?.status === "offline" && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50">
          <p className="text-[11px] text-err flex items-center gap-1.5">
            <XCircle size={12} />
            {health.error || t("settings.game_ai_connection_failed")}
          </p>
        </div>
      )}
    </div>
  );
}
