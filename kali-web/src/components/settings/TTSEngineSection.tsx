import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2, Plug, Unplug } from "lucide-react";
import { apiBase, fetchWithRetry } from "../../lib/api/http";
import type { StatusEvent, TtsModelInfo, TtsDeviceInfo } from "../../lib/protocol";
import { TTS_PROVIDERS } from "../../lib/tts-providers";
import type { TtsProviderId } from "../../lib/tts-providers";
import { PiperVoiceControls } from "./PiperVoiceControls";
import { QwenVoiceControls } from "./QwenVoiceControls";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
  downloadTtsModel: (modelId: string) => void;
  downloadProgress: Record<string, number>;
  downloadError: string | null;
}

export function TTSEngineSection({ systemStatus, onUpdate, downloadTtsModel, downloadProgress, downloadError }: Props) {
  const { t } = useTranslation();
  const activeProvider = systemStatus?.tts_provider ?? TTS_PROVIDERS.PIPER;
  const [tab, setTab] = useState<TtsProviderId>(
    activeProvider === TTS_PROVIDERS.QWEN3 ? TTS_PROVIDERS.QWEN3 : TTS_PROVIDERS.PIPER,
  );
  const [models, setModels] = useState<TtsModelInfo[]>([]);
  const [devices, setDevices] = useState<TtsDeviceInfo[]>([]);
  const [tabVoices, setTabVoices] = useState<Record<string, unknown>[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(systemStatus?.tts_device ?? "cpu");
  const [error, setError] = useState<string | null>(null);
  const [modelsDir, setModelsDir] = useState(systemStatus?.tts_models_dir ?? "");
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (systemStatus?.tts_models_dir) setModelsDir(systemStatus.tts_models_dir);
  }, [systemStatus?.tts_models_dir]);

  useEffect(() => {
    if (activeProvider === TTS_PROVIDERS.QWEN3 || activeProvider === TTS_PROVIDERS.PIPER) {
      setTab(activeProvider);
    }
  }, [activeProvider]);

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

  const loadedVariant = models.find((m) => m.loaded)?.variant ?? null;

  const fetchVoices = useCallback(async (forProvider: string, forVariant: string | null) => {
    try {
      const base = await apiBase();
      const params = new URLSearchParams({ provider: forProvider });
      if (forVariant) params.set("variant", forVariant);
      const resp = await fetchWithRetry(`${base}/voices?${params}`);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) setTabVoices(data.voices ?? []);
      } else {
        if (mountedRef.current) setTabVoices([]);
      }
    } catch {
      if (mountedRef.current) setTabVoices([]);
    }
  }, []);

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

  useEffect(() => {
    void fetchVoices(tab, loadedVariant);
  }, [tab, loadedVariant, fetchVoices]);

  useEffect(() => { setSelectedDevice(systemStatus?.tts_device ?? "cpu"); }, [systemStatus?.tts_device]);

  // Refetch models only when a download completes (progress map goes non-empty → empty).
  const prevDownloadCount = useRef(0);
  useEffect(() => {
    const count = Object.keys(downloadProgress).length;
    if (prevDownloadCount.current > 0 && count === 0) {
      void fetchModels(tab);
    }
    prevDownloadCount.current = count;
  }, [downloadProgress, fetchModels, tab]);

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
        onUpdate({ tts_provider: TTS_PROVIDERS.PIPER });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoadingAction(false);
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    setError(null);
    downloadTtsModel(modelId);
  };

  const handleApplyModelsDir = () => {
    onUpdate({ tts_models_dir: modelsDir });
  };

  const savedModelsDir = systemStatus?.tts_models_dir ?? "";

  const compatibleDevices = devices.filter((d) => tab === TTS_PROVIDERS.QWEN3 || d.id === "cpu");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
        {([TTS_PROVIDERS.PIPER, TTS_PROVIDERS.QWEN3] as TtsProviderId[]).map((p) => (
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
                disabled={loadingAction}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border text-muted hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Unplug size={13} />
                {t("tts.unload")}
              </button>
            ) : m.available ? (
              <button
                onClick={() => handleLoadModel(m.id)}
                disabled={loadingAction}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-accent-dim text-foreground hover:bg-accent-dim/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plug size={13} />
                {t("tts.load")}
              </button>
            ) : downloadProgress[m.id] !== undefined ? (
              <span className="flex items-center gap-1 text-xs px-2.5 py-1 text-accent">
                <Loader2 size={13} className="animate-spin" />
                {t("tts.download_progress", { progress: downloadProgress[m.id] })}
              </span>
            ) : (
              <button
                onClick={() => handleDownloadModel(m.id)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
              >
                <Download size={13} />
                {t("tts.download")}
              </button>
            )}
          </div>
        ))}
      </div>

      {tab === TTS_PROVIDERS.QWEN3 && compatibleDevices.length > 0 && (
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

      {tab === TTS_PROVIDERS.QWEN3 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t("settings.tts_models_dir")}</label>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
              value={modelsDir}
              onChange={(e) => setModelsDir(e.target.value)}
              placeholder={t("tts.models_dir_placeholder")}
            />
            <button
              onClick={handleApplyModelsDir}
              disabled={modelsDir === savedModelsDir}
              className="shrink-0 text-xs px-3 py-2 rounded-md border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("common.apply")}
            </button>
          </div>
          <p className="text-[11px] text-muted/60">{t("settings.tts_models_dir_hint")}</p>
        </div>
      )}

      {activeProvider !== tab && (
        <button
          onClick={() => onUpdate({ tts_provider: tab })}
          disabled={tab === TTS_PROVIDERS.QWEN3 && !models.some((m) => m.loaded)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent-dim text-foreground text-sm font-medium hover:bg-accent-dim/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t(`settings.tts_use_${tab}`)}
        </button>
      )}

      {(error || downloadError) && (
        <div className="text-xs text-err bg-err/10 rounded-md p-2">
          {error ?? downloadError}
        </div>
      )}

      {tab === TTS_PROVIDERS.PIPER ? (
        <PiperVoiceControls
          systemStatus={systemStatus}
          voices={tabVoices}
          onUpdate={onUpdate}
        />
      ) : (
        <QwenVoiceControls
          systemStatus={systemStatus}
          voices={tabVoices}
          variant={loadedVariant}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}
