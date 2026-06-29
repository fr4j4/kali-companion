import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiBase, fetchWithRetry } from "../../lib/api/http";
import type { StatusEvent, TtsModelInfo, TtsDeviceInfo } from "../../lib/protocol";
import { VoiceControls } from "./VoiceControls";

interface Props {
  systemStatus: StatusEvent | null;
  voices: Record<string, unknown>[];
  onUpdate: (patch: Record<string, unknown>) => void;
}

type TtsTab = "piper" | "qwen3";

export function TTSEngineSection({ systemStatus, voices, onUpdate }: Props) {
  const { t } = useTranslation();
  const activeProvider = (systemStatus?.tts_provider ?? "piper") as TtsTab;
  const [tab, setTab] = useState<TtsTab>(activeProvider === "qwen3" ? "qwen3" : "piper");
  const [models, setModels] = useState<TtsModelInfo[]>([]);
  const [devices, setDevices] = useState<TtsDeviceInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(systemStatus?.tts_device ?? "cpu");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const fetchModels = useCallback(async (forProvider?: string) => {
    setLoadingModels(true);
    try {
      const base = await apiBase();
      const url = `${base}/tts/models?provider=${encodeURIComponent(forProvider ?? tab)}`;
      const resp = await fetchWithRetry(url);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) setModels(data.models ?? []);
      }
    } catch { } finally {
      if (mountedRef.current) setLoadingModels(false);
    }
  }, [tab]);

  const fetchDevices = useCallback(async () => {
    try {
      const base = await apiBase();
      const resp = await fetchWithRetry(`${base}/tts/devices`);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) setDevices(data.devices ?? []);
      }
    } catch { }
  }, []);

  useEffect(() => {
    setError(null);
    void fetchModels(tab);
    void fetchDevices();
  }, [fetchModels, fetchDevices, tab]);

  useEffect(() => { setSelectedDevice(systemStatus?.tts_device ?? "cpu"); }, [systemStatus?.tts_device]);

  const handleLoadModel = async (modelId: string) => {
    setLoadingAction(true);
    setError(null);
    try {
      const base = await apiBase();
      const resp = await fetch(
        `${base}/tts/models/${encodeURIComponent(modelId)}/load?device=${encodeURIComponent(selectedDevice)}&provider=${tab}`,
        { method: "POST" },
      );
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? "Failed to load model");
      }
      await fetchModels(tab);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoadingAction(false);
    }
  };

  const handleUnloadModel = async (modelId: string) => {
    setLoadingAction(true);
    setError(null);
    try {
      const base = await apiBase();
      const resp = await fetch(`${base}/tts/models/unload?provider=${tab}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? "Failed to unload model");
      }
      await fetchModels(tab);
      if (activeProvider === tab && systemStatus?.tts_model === modelId) {
        onUpdate({ tts_provider: "piper" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoadingAction(false);
    }
  };

  const compatibleDevices = devices.filter((d) => tab === "qwen3" || d.id === "cpu");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
        {(["piper", "qwen3"] as TtsTab[]).map((p) => (
          <button
            key={p}
            onClick={() => setTab(p)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === p
                ? "bg-accent-dim text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t(`tts.engine.${p}`)}
            {activeProvider === p && (
              <span className="text-[9px] font-mono bg-ok/20 text-ok rounded px-1 py-0.5">
                {t("settings.tts_active")}
              </span>
            )}
          </button>
        ))}
      </div>

      {systemStatus?.tts_error && (
        <div className="text-xs text-err bg-err/10 rounded-md p-2">
          {systemStatus.tts_error}
        </div>
      )}

      <div className="space-y-2">
        {loadingModels && (
          <div className="text-xs text-muted animate-pulse">{t("tts.status.loading")}</div>
        )}
        {!loadingModels && models.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 p-2 bg-surface rounded-md border border-border">
            <div className="flex flex-col min-w-0">
              <span className="text-sm text-foreground truncate">{m.display_name}</span>
              <span className="text-[11px] text-muted">
                {m.loaded ? `✓ ${t("tts.status.loaded")}` : m.available ? t("tts.status.not_loaded") : t("tts.status.no_model")}
                {m.variant && ` · ${m.variant}`}
              </span>
            </div>
            {m.loaded ? (
              <button
                onClick={() => handleUnloadModel(m.id)}
                disabled={loadingAction || activeProvider === tab}
                className="text-xs px-2.5 py-1 rounded-md border border-border text-muted hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("tts.unload")}
              </button>
            ) : (
              <button
                onClick={() => handleLoadModel(m.id)}
                disabled={loadingAction || !m.available}
                className="text-xs px-2.5 py-1 rounded-md bg-accent-dim text-foreground hover:bg-accent-dim/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {m.available ? t("tts.load") : t("tts.download")}
              </button>
            )}
          </div>
        ))}
      </div>

      {tab === "qwen3" && compatibleDevices.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.tts_device")}</label>
          <select
            className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
          >
            {compatibleDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id === "cpu"
                  ? t("tts.device_cpu")
                  : t("tts.device_gpu", { id: d.id, name: d.name })}
              </option>
            ))}
          </select>
        </div>
      )}

      {activeProvider !== tab && (
        <button
          onClick={() => onUpdate({ tts_provider: tab })}
          disabled={tab === "qwen3" && !models.some((m) => m.loaded)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent-dim text-foreground text-sm font-medium hover:bg-accent-dim/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t(`settings.tts_use_${tab}`)}
        </button>
      )}

      {error && (
        <div className="text-xs text-err bg-err/10 rounded-md p-2">{error}</div>
      )}

      <VoiceControls systemStatus={systemStatus} voices={voices} onUpdate={onUpdate} />
    </div>
  );
}