import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download, Loader, Loader2, Mic, Trash2 } from "lucide-react";
import type { StatusEvent, SttProvider, ModelCatalogEntry } from "../../lib/protocol";
import { SelectField, ToggleField } from "./fields";
import { useStage } from "../../stage/StageProvider";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
  downloadSttModel: (modelId: string) => void;
  downloadProgress: Record<string, number>;
  downloadError: string | null;
}

interface SttModelInfo {
  id: string;
  display_name: string;
  estimated_vram_mb: number;
  available: boolean;
  loaded: boolean;
  device: string | null;
  supported_languages: string[];
}

interface SttDeviceInfo {
  id: string;
  name: string;
  vram_total_mb?: number;
  vram_free_mb?: number;
  ram_total_mb?: number;
  ram_free_mb?: number;
}

const STT_LANGS = [
  { id: "es", labelKey: "language.es" },
  { id: "es-CL", labelKey: "language.es_CL" },
  { id: "en", labelKey: "language.en" },
];

async function fetchWithRetry(
  url: string,
  opts: { tries?: number; baseDelay?: number } = {},
): Promise<Response | null> {
  const tries = opts.tries ?? 3;
  const baseDelay = opts.baseDelay ?? 400;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const resp = await fetch(url);
      if (resp.ok || resp.status >= 400) return resp;
      return resp;
    } catch {
      if (attempt === tries) return null;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** (attempt - 1)));
    }
  }
  return null;
}

async function getSidecarPort(): Promise<number | null> {
  try {
    const resp = await fetch("/api/sidecar-port");
    if (resp.ok) {
      const data = await resp.json();
      return data.port ?? null;
    }
  } catch {
    // not running in Tauri shell
  }
  return null;
}

export function STTSection({ systemStatus, onUpdate, downloadSttModel, downloadProgress, downloadError }: Props) {
  const { t } = useTranslation();
  const { sttLanguage } = useStage();

  const activeProvider = (systemStatus?.stt_provider ?? "vosk") as SttProvider;
  const sttLoaded = systemStatus?.stt_loaded ?? (activeProvider === "vosk");
  const sttModel = systemStatus?.stt_model ?? "";
  const sttDevice = systemStatus?.stt_device ?? "";
  const sttStreaming = systemStatus?.stt_streaming ?? true;
  const sttModelsDir = systemStatus?.stt_models_dir ?? "";
  const sttEnabled = systemStatus?.stt_enabled ?? false;

  const [tab, setTab] = useState<SttProvider>(activeProvider);
  const [models, setModels] = useState<SttModelInfo[]>([]);
  const [devices, setDevices] = useState<SttDeviceInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(sttDevice || "cpu");
  const [modelsDir, setModelsDir] = useState(sttModelsDir || t("stt.models_dir_placeholder"));
  const [error, setError] = useState<string | null>(null);
  const [savedModelsDir, setSavedModelsDir] = useState(sttModelsDir || t("stt.models_dir_placeholder"));
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [catalogLanguages, setCatalogLanguages] = useState<string[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogLangFilter, setCatalogLangFilter] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [subTab, setSubTab] = useState<"installed" | "catalog">("installed");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setTab(activeProvider);
  }, [activeProvider]);

  const apiBase = useCallback(async () => {
    const port = await getSidecarPort();
    const host = window.location.hostname;
    return `http://${host}:${port ?? 8900}`;
  }, []);

  const fetchModels = useCallback(async (forProvider?: string) => {
    setLoadingModels(true);
    try {
      const base = await apiBase();
      const url = forProvider
        ? `${base}/stt/models?provider=${encodeURIComponent(forProvider)}`
        : `${base}/stt/models`;
      const resp = await fetchWithRetry(url);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) setModels(data.models ?? []);
      }
    } catch {
      // keep current
    } finally {
      if (mountedRef.current) setLoadingModels(false);
    }
  }, [apiBase]);

  const fetchDevices = useCallback(async () => {
    try {
      const base = await apiBase();
      const resp = await fetchWithRetry(`${base}/stt/devices`);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) setDevices(data.devices ?? []);
      }
    } catch {
      // keep current
    }
  }, [apiBase]);

  useEffect(() => {
    setError(null);
    void fetchModels(tab);
    void fetchDevices();
  }, [fetchModels, fetchDevices, tab]);

  // Fetch catalog when on specific tab.
  const fetchCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const base = await apiBase();
      const provider = tab === "qwen3" ? "qwen3-asr" : tab;
      const resp = await fetch(`${base}/models/catalog?provider=${provider}`);
      if (resp && resp.ok) {
        const data = await resp.json();
        if (mountedRef.current) {
          setCatalog(data.models ?? []);
          setCatalogLanguages(data.languages ?? []);
        }
      }
    } catch { } finally {
      if (mountedRef.current) setLoadingCatalog(false);
    }
  }, [apiBase, tab]);

  useEffect(() => {
    void fetchCatalog();
  }, [tab, fetchCatalog]);

  // Refetch catalog/models when a download completes (progress map empties).
  const prevDlCount = useRef(0);
  useEffect(() => {
    const count = Object.keys(downloadProgress).length;
    if (prevDlCount.current > 0 && count === 0) {
      void fetchModels(tab);
      void fetchCatalog();
    }
    prevDlCount.current = count;
  }, [downloadProgress, fetchCatalog, fetchModels, tab]);

  useEffect(() => {
    setSelectedDevice(sttDevice || "cpu");
  }, [sttDevice]);

  useEffect(() => {
    setModelsDir(sttModelsDir || t("stt.models_dir_placeholder"));
    setSavedModelsDir(sttModelsDir || t("stt.models_dir_placeholder"));
  }, [sttModelsDir]);

  const handleLoadModel = async (modelId: string) => {
    setLoadingAction(true);
    setError(null);
    try {
      const base = await apiBase();
      const resp = await fetch(`${base}/stt/models/${encodeURIComponent(modelId)}/load?device=${encodeURIComponent(selectedDevice)}&provider=${tab}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? t("stt.failed_load_model"));
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
      const resp = await fetch(`${base}/stt/models/unload?provider=${tab}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? t("stt.failed_unload_model"));
      }
      await fetchModels(tab);
      // Auto-switch to Vosk if the active Qwen3 model was unloaded
      if (activeProvider === "qwen3" && sttModel === modelId) {
        onUpdate({ stt_provider: "vosk" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoadingAction(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!window.confirm(t("models.delete_confirm", { name: modelId }))) return;
    setLoadingAction(true);
    setError(null);
    try {
      const base = await apiBase();
      const resp = await fetch(`${base}/stt/models/${encodeURIComponent(modelId)}/delete?provider=${tab}`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? "Failed to delete model");
      }
      await fetchModels(tab);
      await fetchCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoadingAction(false);
    }
  };

  const handleModelsDirChange = (dir: string) => {
    setModelsDir(dir);
  };

  const handleApplyModelsDir = () => {
    setSavedModelsDir(modelsDir);
    onUpdate({ stt_models_dir: modelsDir });
  };

  const compatibleDevices = devices.filter((d) => d.id === "cpu" || tab === "qwen3");

  const activeDotClass = activeProvider === "vosk"
    ? "bg-ok"
    : sttLoaded
      ? "bg-ok"
      : "bg-muted";

  const activeLabel = activeProvider === "vosk"
    ? t("stt.provider.vosk")
    : sttLoaded
      ? `${sttModel} · ${sttDevice}`
      : `${t("stt.provider.qwen3")} · ${t("stt.status.not_loaded")}`;

  const qwenHasLoadedModel = models.some((m) => m.loaded);

  return (
    <div className="flex flex-col gap-4">
      {/* Active model bar — always visible */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
        <span className={`w-2 h-2 rounded-full ${activeDotClass}`} />
        <span className="text-xs text-foreground font-medium">{activeLabel}</span>
        {loadingAction && <Loader size={12} className="animate-spin text-muted ml-auto" />}
      </div>

      {/* STT on/off toggle */}
      <ToggleField
        label={t("settings.stt_enabled")}
        checked={sttEnabled}
        onChange={(v) => onUpdate({ stt_enabled: v })}
      />

      {/* Provider selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted">{t("settings.stt_provider")}</label>
        <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
          {(["vosk", "qwen3"] as SttProvider[]).map((p) => (
            <button
              key={p}
              onClick={() => { setTab(p); setSubTab("installed"); }}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
                tab === p
                  ? "bg-accent/15 text-accent border border-accent/40"
                  : "text-muted hover:text-foreground border border-transparent"
              }`}
            >
              <Mic size={13} />
              {t(`stt.provider.${p}`)}
              {activeProvider === p && (
                <span className="text-[9px] font-mono bg-ok/20 text-ok rounded px-1 py-0.5">
                  {t("settings.stt_active")}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs: Installed / Catalog */}
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

      {subTab === "installed" && (
        <div className="flex flex-col gap-3">
          {/* Model list */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{t("settings.stt_model")}</label>
            {loadingModels ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-surface border border-border rounded-lg text-xs text-muted">
                <Loader size={12} className="animate-spin" />
                {t("ai.loading_models")}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {models.filter(m => m.available).length === 0 && (
                  <div className="text-xs text-muted py-4 text-center">
                    {t("models.no_results")}
                  </div>
                )}
                {models.filter(m => m.available).map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface border border-border"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${m.loaded ? "bg-ok" : "bg-muted"}`} />
                      <span className="text-xs text-foreground">
                        {m.display_name}
                        {tab === "qwen3" && ` (${m.estimated_vram_mb} MB)`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.loaded ? (
                        <button
                          onClick={() => handleUnloadModel(m.id)}
                          disabled={loadingAction}
                          className="text-[10px] font-medium text-err hover:text-err/80 transition-colors disabled:opacity-40"
                        >
                          {t("settings.stt_unload_model")}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleLoadModel(m.id)}
                            disabled={loadingAction}
                            className="text-[10px] font-medium text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
                          >
                            {t("settings.stt_load_model")}
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
            )}
          </div>

          {/* Device selector for Qwen3 */}
          {tab === "qwen3" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted">{t("settings.stt_device")}</label>
              {compatibleDevices.length === 0 ? (
                <p className="text-xs text-err">{t("settings.stt_no_device")}</p>
              ) : (
                <select
                  className="bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                >
                  {compatibleDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id === "cpu"
                        ? t("stt.device_cpu", {
                            free: d.ram_free_mb != null ? ((d.ram_free_mb ?? 0) / 1024).toFixed(0) : "",
                          })
                        : t("stt.device_gpu", {
                            id: d.id,
                            name: d.name,
                            free: ((d.vram_free_mb ?? 0) / 1024).toFixed(1),
                            total: ((d.vram_total_mb ?? 0) / 1024).toFixed(1),
                          })}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Use provider button */}
          {activeProvider !== tab && (
            <button
              onClick={() => onUpdate({ stt_provider: tab })}
              disabled={tab === "qwen3" && !qwenHasLoadedModel}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent bg-accent/10 text-xs font-medium text-accent hover:bg-accent/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={13} />
              {t(`settings.stt_use_${tab}`)}
            </button>
          )}
        </div>
      )}

      {subTab === "catalog" && (
        <div className="flex flex-col gap-2">
          {tab === "vosk" && (
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
                placeholder={t("models.search_placeholder")}
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
              {catalogLanguages.length > 0 && (
                <select
                  className="bg-surface text-foreground border border-border rounded-md px-2 py-1.5 text-xs outline-none"
                  value={catalogLangFilter}
                  onChange={(e) => setCatalogLangFilter(e.target.value)}
                >
                  <option value="">{t("models.filter_all")}</option>
                  {catalogLanguages.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto flex flex-col gap-1 rounded-md border border-border">
            {loadingCatalog && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
                <Loader2 size={12} className="animate-spin" />
                {"Loading..."}
              </div>
            )}
            {!loadingCatalog && catalog
              .filter((m) => {
                const matchSearch = !catalogSearch
                  || m.display_name.toLowerCase().includes(catalogSearch.toLowerCase())
                  || m.language.toLowerCase().includes(catalogSearch.toLowerCase());
                const matchLang = !catalogLangFilter || m.language === catalogLangFilter;
                return matchSearch && matchLang;
              })
              .map((m) => {
                const isDownloaded = m.downloaded || models.some(im => im.id === m.id && im.available);
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
                        onClick={() => downloadSttModel(m.id)}
                        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors shrink-0"
                      >
                        <Download size={10} />
                        {t("models.download")}
                      </button>
                    )}
                  </div>
                );
              })}
            {!loadingCatalog && catalog.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted">{t("models.no_results")}</div>
            )}
          </div>
        </div>
      )}

      {/* Common settings for Qwen3 */}
      {tab === "qwen3" && (
        <div className="flex flex-col gap-3">
          <ToggleField
            label={t("settings.stt_streaming")}
            checked={sttStreaming}
            onChange={(v) => onUpdate({ stt_streaming: v })}
          />
          <p className="text-[10px] text-muted/60 -mt-3">{t("settings.stt_streaming_desc")}</p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{t("settings.stt_models_dir")}</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-surface text-foreground border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-accent-dim"
                value={modelsDir}
                onChange={(e) => handleModelsDirChange(e.target.value)}
                placeholder={t("stt.models_dir_placeholder")}
              />
              <button
                onClick={handleApplyModelsDir}
                disabled={modelsDir === savedModelsDir}
                className="shrink-0 text-xs px-3 py-2 rounded-md border border-accent/40 text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("common.apply")}
              </button>
            </div>
            <p className="text-[11px] text-muted/60">{t("settings.stt_models_dir_hint")}</p>
          </div>
        </div>
      )}

      {/* Error display */}
      {(error || downloadError) && (
        <div className="px-3 py-2 rounded-lg bg-err/10 border border-err/30 text-err text-xs whitespace-pre-wrap">
          {(error || downloadError)?.split("\n").map((line, i) =>
            line.trim().startsWith("pip ") ? (
              <button
                key={i}
                onClick={() => navigator.clipboard.writeText(line.trim())}
                className="block w-full text-left bg-black/80 dark:bg-black/90 rounded px-3 py-2 mt-1 font-mono text-[11px] text-green-400 border border-white/10 cursor-pointer hover:bg-black/90 transition-colors"
                title={t("common.click_to_copy")}
              >
                <span className="select-all">{line.trim()}</span>
              </button>
            ) : (
              <span key={i}>{line}{i < (error || downloadError)!.split("\n").length - 1 ? "\n" : ""}</span>
            )
          )}
        </div>
      )}

      {/* STT Language selector (shared) */}
      <SelectField
        label={t("settings.stt_language")}
        value={sttLanguage}
        onChange={(v) => onUpdate({ stt_language: v })}
      >
        {STT_LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {t(l.labelKey)}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
