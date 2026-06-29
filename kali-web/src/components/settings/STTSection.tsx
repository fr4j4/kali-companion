import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader, Mic } from "lucide-react";
import type { StatusEvent, SttProvider } from "../../lib/protocol";
import { SelectField, ToggleField } from "./fields";
import { useStage } from "../../stage/StageProvider";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Record<string, unknown>) => void;
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

export function STTSection({ systemStatus, onUpdate }: Props) {
  const { t } = useTranslation();
  const { sttLanguage } = useStage();

  const activeProvider = (systemStatus?.stt_provider ?? "vosk") as SttProvider;
  const sttLoaded = systemStatus?.stt_loaded ?? (activeProvider === "vosk");
  const sttModel = systemStatus?.stt_model ?? "";
  const sttDevice = systemStatus?.stt_device ?? "";
  const sttStreaming = systemStatus?.stt_streaming ?? true;
  const sttModelsDir = systemStatus?.stt_models_dir ?? "";

  const [tab, setTab] = useState<SttProvider>(activeProvider);
  const [models, setModels] = useState<SttModelInfo[]>([]);
  const [devices, setDevices] = useState<SttDeviceInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(sttDevice || "cpu");
  const [modelsDir, setModelsDir] = useState(sttModelsDir || t("stt.models_dir_placeholder"));
  const [error, setError] = useState<string | null>(null);
  const [savedModelsDir, setSavedModelsDir] = useState(sttModelsDir || t("stt.models_dir_placeholder"));
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

  const handleModelsDirChange = (dir: string) => {
    setModelsDir(dir);
  };

  const handleApplyModelsDir = () => {
    setSavedModelsDir(modelsDir);
    onUpdate({ stt_models_dir: modelsDir });
  };

  const requiredVram = 0; // no specific model selected for device filtering

  const compatibleDevices = devices.filter((d) => {
    if (d.id === "cpu") return true;
    if (d.vram_free_mb != null && d.vram_free_mb >= requiredVram) return true;
    return false;
  });

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

      {/* View-only tabs */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted">{t("settings.stt_provider")}</label>
        <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
          {(["vosk", "qwen3"] as SttProvider[]).map((p) => (
            <button
              key={p}
              onClick={() => setTab(p)}
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

      {/* Vosk tab */}
      {tab === "vosk" && (
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
                {models.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface border border-border"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${m.loaded ? "bg-ok" : "bg-muted"}`} />
                      <span className="text-xs text-foreground">{m.display_name}</span>
                    </div>
                    {m.loaded ? (
                      <button
                        onClick={() => handleUnloadModel(m.id)}
                        disabled={loadingAction}
                        className="text-[10px] font-medium text-err hover:text-err/80 transition-colors disabled:opacity-40"
                      >
                        {t("settings.stt_unload_model")}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLoadModel(m.id)}
                        disabled={loadingAction}
                        className="text-[10px] font-medium text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
                      >
                        {m.available ? t("settings.stt_load_model") : t("settings.stt_download_model")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Use Vosk button */}
          {activeProvider !== "vosk" && (
            <button
              onClick={() => onUpdate({ stt_provider: "vosk" })}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent bg-accent/10 text-xs font-medium text-accent hover:bg-accent/20 transition-all"
            >
              <Check size={13} />
              {t("settings.stt_use_vosk")}
            </button>
          )}
        </div>
      )}

      {/* Qwen3 tab */}
      {tab === "qwen3" && (
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
                {models.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface border border-border"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${m.loaded ? "bg-ok" : "bg-muted"}`} />
                      <span className="text-xs text-foreground">
                        {m.display_name} ({m.estimated_vram_mb} MB)
                      </span>
                    </div>
                    {m.loaded ? (
                      <button
                        onClick={() => handleUnloadModel(m.id)}
                        disabled={loadingAction}
                        className="text-[10px] font-medium text-err hover:text-err/80 transition-colors disabled:opacity-40"
                      >
                        {t("settings.stt_unload_model")}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLoadModel(m.id)}
                        disabled={loadingAction}
                        className="text-[10px] font-medium text-accent hover:text-accent/80 transition-colors disabled:opacity-40"
                      >
                        {m.available ? t("settings.stt_load_model") : t("settings.stt_download_model")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Device selector */}
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

          {/* Streaming toggle */}
          <ToggleField
            label={t("settings.stt_streaming")}
            checked={sttStreaming}
            onChange={(v) => onUpdate({ stt_streaming: v })}
          />
          <p className="text-[10px] text-muted/60 -mt-3">{t("settings.stt_streaming_desc")}</p>

          {/* Models directory */}
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

          {/* Use Qwen3 button */}
          {activeProvider !== "qwen3" && (
            <button
              onClick={() => onUpdate({ stt_provider: "qwen3" })}
              disabled={!qwenHasLoadedModel}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-accent bg-accent/10 text-xs font-medium text-accent hover:bg-accent/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={13} />
              {t("settings.stt_use_qwen3")}
            </button>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-err/10 border border-err/30 text-err text-xs whitespace-pre-wrap">
          {error.split("\n").map((line, i) =>
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
              <span key={i}>{line}{i < error.split("\n").length - 1 ? "\n" : ""}</span>
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
