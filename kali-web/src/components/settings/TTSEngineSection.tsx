import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader, Loader2, Plug, Unplug, Trash2 } from "lucide-react";
import { apiBase, fetchWithRetry } from "../../lib/api/http";
import type { StatusEvent, TtsModelInfo, TtsDeviceInfo, ModelCatalogEntry } from "../../lib/protocol";
import { TTS_PROVIDERS } from "../../lib/tts-providers";
import type { TtsProviderId } from "../../lib/tts-providers";
import { ToggleField } from "./fields";
import { PiperVoiceControls } from "./PiperVoiceControls";
import { QwenVoiceControls } from "./QwenVoiceControls";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
  downloadTtsModel: (modelId: string, provider?: "qwen3" | "piper") => void;
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
  const [piperCatalog, setPiperCatalog] = useState<ModelCatalogEntry[]>([]);
  const [piperCatalogLangs, setPiperCatalogLangs] = useState<string[]>([]);
  const [piperSearch, setPiperSearch] = useState("");
  const [piperLangFilter, setPiperLangFilter] = useState("");
  const [loadingPiperCatalog, setLoadingPiperCatalog] = useState(false);
  const [qwenCatalog, setQwenCatalog] = useState<ModelCatalogEntry[]>([]);
  const [loadingQwenCatalog, setLoadingQwenCatalog] = useState(false);
  const [subTab, setSubTab] = useState<"installed" | "catalog">("installed");
  const mountedRef = useRef(true);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (systemStatus?.tts_models_dir) setModelsDir(systemStatus.tts_models_dir);
  }, [systemStatus?.tts_models_dir]);

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
      const refetches: Promise<void>[] = [fetchModels(tab)];
      if (tab === TTS_PROVIDERS.PIPER) refetches.push(fetchPiperCatalog());
      if (tab === TTS_PROVIDERS.QWEN3) refetches.push(fetchQwenCatalog());
      void Promise.all(refetches);
    }
    prevDownloadCount.current = count;
  }, [downloadProgress, fetchModels, tab]);

  const fetchPiperCatalog = useCallback(async () => {
    setLoadingPiperCatalog(true);
    try {
      const base = await apiBase();
      const resp = await fetch(`${base}/models/catalog?provider=piper`);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) {
          setPiperCatalog(data.models ?? []);
          setPiperCatalogLangs(data.languages ?? []);
        }
      }
    } catch { } finally {
      if (mountedRef.current) setLoadingPiperCatalog(false);
    }
  }, [apiBase]);

  const fetchQwenCatalog = useCallback(async () => {
    setLoadingQwenCatalog(true);
    try {
      const base = await apiBase();
      const resp = await fetch(`${base}/models/catalog?provider=qwen3`);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) {
          setQwenCatalog(data.models ?? []);
        }
      }
    } catch { } finally {
      if (mountedRef.current) setLoadingQwenCatalog(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (tab === TTS_PROVIDERS.PIPER) void fetchPiperCatalog();
    if (tab === TTS_PROVIDERS.QWEN3) void fetchQwenCatalog();
  }, [tab, fetchPiperCatalog, fetchQwenCatalog]);

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
    downloadTtsModel(modelId, tab === TTS_PROVIDERS.QWEN3 ? "qwen3" : "piper");
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!window.confirm(t("models.delete_confirm", { name: modelId }))) return;
    setLoadingAction(true);
    setError(null);
    try {
      const base = await apiBase();
      const resp = await fetch(`${base}/tts/models/${encodeURIComponent(modelId)}/delete?provider=${tab}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? "Failed to delete model");
      }
      await fetchModels(tab);
      if (tab === TTS_PROVIDERS.PIPER) await fetchPiperCatalog();
      if (tab === TTS_PROVIDERS.QWEN3) await fetchQwenCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoadingAction(false);
    }
  };

  const handleApplyModelsDir = () => {
    onUpdate({ tts_models_dir: modelsDir });
  };

  const savedModelsDir = systemStatus?.tts_models_dir ?? "";
  const compatibleDevices = devices.filter((d) => tab === TTS_PROVIDERS.QWEN3 || d.id === "cpu");

  const ttsLoaded = systemStatus?.tts_loaded ?? false;
  const ttsModel = systemStatus?.tts_model ?? "";
  const ttsDevice = systemStatus?.tts_device ?? "";
  const autoTts = systemStatus?.auto_tts ?? false;

  const ttsActiveDotClass = ttsLoaded ? "bg-ok" : "bg-muted";
  const ttsActiveLabel = ttsLoaded
    ? `${ttsModel} · ${ttsDevice}`
    : `${t(`tts.engine.${activeProvider}`)} · ${t("tts.status.not_loaded")}`;

  return (
    <div className="space-y-4">
      {/* Active TTS bar — always visible */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
        <span className={`w-2 h-2 rounded-full ${ttsActiveDotClass}`} />
        <span className="text-xs text-foreground font-medium">{ttsActiveLabel}</span>
        {loadingAction && <Loader size={12} className="animate-spin text-muted ml-auto" />}
      </div>

      {/* TTS on/off toggle */}
      <ToggleField
        label={t("settings.tts_enabled")}
        checked={autoTts}
        onChange={(v) => onUpdate({ auto_tts: v })}
      />

      <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
        {([TTS_PROVIDERS.PIPER, TTS_PROVIDERS.QWEN3] as TtsProviderId[]).map((p) => (
          <button
            key={p}
            onClick={() => { setTab(p); setSubTab("installed"); }}
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

      {(tab === TTS_PROVIDERS.PIPER || tab === TTS_PROVIDERS.QWEN3) && (
        <div className="flex gap-4 border-b border-border mb-2">
          {(["installed", "catalog"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setSubTab(st)}
              className={`pb-2 text-xs font-medium transition-colors relative ${
                subTab === st
                  ? "text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t(`models.${st}`)}
              {subTab === st && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-dim" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {loadingModels && (
          <div className="text-xs text-muted animate-pulse">{t("tts.status.loading")}</div>
        )}
        {!loadingModels && subTab === "installed" && models.filter(m => m.available).length === 0 && (
          <div className="text-xs text-muted py-4 text-center">
            {t("models.no_results")}
          </div>
        )}
        {!loadingModels && subTab === "installed" && models.filter(m => m.available).map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 p-2 bg-surface rounded-md border border-border">
            <div className="flex flex-col min-w-0">
              <span className="text-sm text-foreground truncate">{m.display_name}</span>
              <span className="text-[11px] text-muted">
                {m.loaded ? `✓ ${t("tts.status.loaded")}` : t("tts.status.not_loaded")}
                {m.variant && ` · ${m.variant}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {m.loaded ? (
                <button
                  onClick={() => handleUnloadModel(m.id)}
                  disabled={loadingAction}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-border text-muted hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Unplug size={13} />
                  {t("tts.unload")}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleLoadModel(m.id)}
                    disabled={loadingAction}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-accent-dim text-foreground hover:bg-accent-dim/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plug size={13} />
                    {t("tts.load")}
                  </button>
                  <button
                    onClick={() => handleDeleteModel(m.id)}
                    disabled={loadingAction}
                    className="p-1.5 text-muted hover:text-err transition-colors"
                    title={t("common.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {tab === TTS_PROVIDERS.QWEN3 && subTab === "installed" && compatibleDevices.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-2">
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

      {tab === TTS_PROVIDERS.QWEN3 && subTab === "installed" && (
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

      {/* Qwen voice download catalog */}
      {tab === TTS_PROVIDERS.QWEN3 && subTab === "catalog" && (
        <div className="flex flex-col gap-2">
          <div className="max-h-64 overflow-y-auto scrollbar-thin flex flex-col gap-1 rounded-md border border-border">
            {loadingQwenCatalog && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
                <Loader2 size={12} className="animate-spin" />
                {"Loading..."}
              </div>
            )}
            {!loadingQwenCatalog && qwenCatalog.map((m) => {
              const isDownloaded = m.downloaded;
              return (
                <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-foreground truncate">{m.display_name}</span>
                    <span className="text-[10px] text-muted">{m.language} · {m.quality} · {m.size_mb} MB</span>
                  </div>
                  {isDownloaded ? (
                    <span className="text-[10px] text-ok shrink-0">✓ {t("models.downloaded")}</span>
                  ) : downloadProgress[m.id] !== undefined ? (
                    <span className="flex items-center gap-1 text-[10px] text-accent shrink-0">
                      <Loader2 size={11} className="animate-spin" />
                      {downloadProgress[m.id]}%
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDownloadModel(m.id)}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors shrink-0"
                    >
                      <Download size={10} />
                      {t("models.download")}
                    </button>
                  )}
                </div>
              );
            })}
            {!loadingQwenCatalog && qwenCatalog.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted">{t("models.no_results")}</div>
            )}
          </div>
        </div>
      )}

      {/* Piper voice download catalog */}
      {tab === TTS_PROVIDERS.PIPER && subTab === "catalog" && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
              placeholder={t("models.search_placeholder")}
              value={piperSearch}
              onChange={(e) => setPiperSearch(e.target.value)}
            />
            {piperCatalogLangs.length > 0 && (
              <select
                className="bg-surface text-foreground border border-border rounded-md px-2 py-1.5 text-xs outline-none"
                value={piperLangFilter}
                onChange={(e) => setPiperLangFilter(e.target.value)}
              >
                <option value="">{t("models.filter_all")}</option>
                {piperCatalogLangs.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin flex flex-col gap-1 rounded-md border border-border">
            {loadingPiperCatalog && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
                <Loader2 size={12} className="animate-spin" />
                {"Loading..."}
              </div>
            )}
            {!loadingPiperCatalog && piperCatalog
              .filter((m) => {
                const matchSearch = !piperSearch
                  || m.display_name.toLowerCase().includes(piperSearch.toLowerCase())
                  || m.language.toLowerCase().includes(piperSearch.toLowerCase());
                const matchLang = !piperLangFilter || m.language === piperLangFilter;
                return matchSearch && matchLang;
              })
              .map((m) => {
                const isDownloaded = m.downloaded;
                return (
                  <div key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/50 last:border-0">
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs text-foreground truncate">{m.display_name}</span>
                      <span className="text-[10px] text-muted">{m.language} · {m.quality} · {m.size_mb} MB</span>
                    </div>
                    {isDownloaded ? (
                      <span className="text-[10px] text-ok shrink-0">✓ {t("models.downloaded")}</span>
                    ) : downloadProgress[m.id] !== undefined ? (
                      <span className="flex items-center gap-1 text-[10px] text-accent shrink-0">
                        <Loader2 size={11} className="animate-spin" />
                        {downloadProgress[m.id]}%
                      </span>
                    ) : (
                      <button
                        onClick={() => handleDownloadModel(m.id)}
                        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors shrink-0"
                      >
                        <Download size={10} />
                        {t("models.download")}
                      </button>
                    )}
                  </div>
                );
              })}
            {!loadingPiperCatalog && piperCatalog.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted">{t("models.no_results")}</div>
            )}
          </div>
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
