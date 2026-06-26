// ProviderSection — AI provider configuration (migrated from AIConfigModal).
//
// Redesigned selector: segmented Local/Cloud + provider cards with port + dot,
// scan collapsed by default, teal instrument-panel accent for this section only.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  Cloud,
  Eye,
  EyeOff,
  HardDrive,
  Loader,
  RefreshCw,
  Search,
  X,
  Zap,
} from "lucide-react";
import {
  type LocalEndpoint,
  type ProviderPreset,
  findPresetById,
  PROVIDER_PRESETS,
} from "../../lib/aiPresets";
import type { SettingsEvent, StatusEvent } from "../../lib/protocol";

interface Props {
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Partial<SettingsEvent>) => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";
type ScanState = "idle" | "scanning" | "done";
type ProviderKind = "local" | "cloud";

export function ProviderSection({ systemStatus, onUpdate }: Props) {
  const { t, i18n } = useTranslation();
  const isEs = i18n.language === "es";

  const [presetId, setPresetId] = useState("ollama_local");
  const [apiUrl, setApiUrl] = useState("http://127.0.0.1:11434/v1");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelInput, setModelInput] = useState("");
  const [useModelInput, setUseModelInput] = useState(false);

  const [scanHost, setScanHost] = useState("127.0.0.1");
  const [portFrom, setPortFrom] = useState(8000);
  const [portTo, setPortTo] = useState(12300);
  const [scanResults, setScanResults] = useState<LocalEndpoint[]>([]);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanOpen, setScanOpen] = useState(false);

  const [testState, setTestState] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);

  const scanTimerRef = useRef<number | null>(null);

  const currentPreset: ProviderPreset | undefined = findPresetById(presetId);
  const isLocal = currentPreset?.kind === "local";
  const showApiKey = currentPreset?.requiresApiKey || apiKey.length > 0;

  // Active tab for segmented control — derive from current preset
  const activeKind: ProviderKind = currentPreset?.kind === "cloud" ? "cloud" : "local";

  useEffect(() => {
    if (!systemStatus) return;
    const savedUrl = systemStatus.llm_api_url || "";
    const matched = PROVIDER_PRESETS.find((p) => p.apiUrl === savedUrl);
    setPresetId(matched?.id ?? "custom");
    setApiUrl(savedUrl);
    setSelectedModel(systemStatus.llm_model ?? "");
    setModelInput(systemStatus.llm_model ?? "");
    setApiKey("");
    setTestState("idle");
    setTestMsg("");
    setScanResults([]);
    setScanState("idle");
    setModels([]);
    setUseModelInput(false);
  }, [systemStatus]);

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    };
  }, []);

  const fetchModels = useCallback(async (url: string, key: string) => {
    setLoadingModels(true);
    setModels([]);
    try {
      const res = await fetch(
        `/llm/models?api_url=${encodeURIComponent(url)}&api_key=${encodeURIComponent(key)}`,
      );
      const data = await res.json();
      const list: string[] = data.models ?? [];
      setModels(list);
      if (list.length > 0) {
        setSelectedModel(list[0]);
        setUseModelInput(false);
      } else {
        setUseModelInput(true);
      }
    } catch {
      setModels([]);
      setUseModelInput(true);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const testConnection = useCallback(async () => {
    setTestState("testing");
    setTestMsg("");
    try {
      const res = await fetch(
        `/llm/models?api_url=${encodeURIComponent(apiUrl)}&api_key=${encodeURIComponent(apiKey)}`,
      );
      const data = await res.json();
      const list: string[] = data.models ?? [];
      if (res.ok && list.length > 0) {
        setModels(list);
        if (!selectedModel) setSelectedModel(list[0]);
        setTestState("ok");
        setTestMsg(t("provider.test_ok_models", { count: list.length }) as string);
      } else if (res.ok) {
        setTestState("ok");
        setTestMsg(t("provider.test_ok_no_models") as string);
        setUseModelInput(true);
      } else {
        setTestState("fail");
        setTestMsg(data.detail ?? (t("provider.test_fail") as string));
      }
    } catch (e) {
      setTestState("fail");
      setTestMsg(String(e));
    }
  }, [apiUrl, apiKey, selectedModel, t]);

  const handleScan = useCallback(async () => {
    setScanState("scanning");
    setScanResults([]);
    try {
      const res = await fetch(
        `/llm/scan?host=${encodeURIComponent(scanHost)}&from_port=${portFrom}&to_port=${portTo}`,
      );
      const data = await res.json();
      const found: LocalEndpoint[] = data.endpoints ?? [];
      setScanResults(found);
      setScanState("done");
    } catch {
      setScanResults([]);
      setScanState("done");
    }
  }, [scanHost, portFrom, portTo]);

  const handleApply = useCallback(
    (overrides?: { presetId?: string; apiUrl?: string; apiKey?: string; model?: string }) => {
      const model = overrides?.model ?? (useModelInput ? modelInput : selectedModel);
      onUpdate({
        llm_model: model,
        llm_api_url: overrides?.apiUrl ?? apiUrl,
        llm_api_key: overrides?.apiKey ?? apiKey,
        llm_provider: (overrides?.presetId ?? presetId) === "custom" ? "direct" : overrides?.presetId ?? presetId,
      });
    },
    [useModelInput, modelInput, selectedModel, apiUrl, apiKey, presetId, onUpdate],
  );

  const handlePresetSelect = useCallback(
    (id: string) => {
      setPresetId(id);
      const preset = findPresetById(id);
      if (preset && id !== "custom") {
        setApiUrl(preset.apiUrl);
        setTestState("idle");
        setTestMsg("");
        setModels([]);
        setUseModelInput(false);
        if (!preset.requiresApiKey) {
          setApiKey("");
          void fetchModels(preset.apiUrl, "");
        }
        handleApply({ presetId: id, apiUrl: preset.apiUrl, apiKey: "" });
      }
    },
    [fetchModels, handleApply],
  );

  const handleEndpointSelect = useCallback(
    (endpoint: LocalEndpoint) => {
      setApiUrl(endpoint.url);
      setPresetId("custom");
      if (endpoint.models.length > 0) {
        setModels(endpoint.models);
        setSelectedModel(endpoint.models[0]);
        setUseModelInput(false);
        setTestState("ok");
        setTestMsg(
          t("provider.endpoint_selected", {
            vendor: endpoint.vendor,
            port: endpoint.port,
            count: endpoint.models.length,
          }) as string,
        );
      } else {
        setModels([]);
        setUseModelInput(true);
        setTestState("ok");
        setTestMsg(
          t("provider.endpoint_selected_no_models", {
            vendor: endpoint.vendor,
            port: endpoint.port,
          }) as string,
        );
      }
      handleApply({ presetId: "custom", apiUrl: endpoint.url });
    },
    [t, handleApply],
  );

  const localPresets = PROVIDER_PRESETS.filter((p) => p.kind === "local");
  const cloudPresets = PROVIDER_PRESETS.filter((p) => p.kind === "cloud");
  const visiblePresets = activeKind === "local" ? localPresets : cloudPresets;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Segmented Local / Cloud ─────────────────────── */}
      <div className="flex gap-1 p-1 bg-ai-bg rounded-lg border border-ai-rail">
        {(["local", "cloud"] as ProviderKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => {
              const first = (kind === "local" ? localPresets : cloudPresets)[0];
              if (first) handlePresetSelect(first.id);
            }}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
              activeKind === kind
                ? "bg-ai-signal/15 text-ai-signal border border-ai-signal/40"
                : "text-ai-label hover:text-ai-readout border border-transparent"
            }`}
          >
            {kind === "local" ? <HardDrive size={13} /> : <Cloud size={13} />}
            {kind === "local" ? t("provider.local") : t("provider.cloud")}
          </button>
        ))}
      </div>

      {/* ── Provider cards ──────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {visiblePresets.map((preset) => {
          const active = presetId === preset.id;
          const label = isEs ? preset.labelEs : preset.label;
          const port = preset.apiUrl.match(/:(\d+)\//)?.[1] ?? "";
          return (
            <button
              key={preset.id}
              onClick={() => handlePresetSelect(preset.id)}
              className={`group relative px-3 py-2.5 rounded-lg border text-left transition-all ${
                active
                  ? "border-ai-signal bg-ai-signal/10 text-ai-readout shadow-sm shadow-ai-signal/10"
                  : "border-ai-rail bg-ai-panel text-ai-label hover:border-ai-signal/30 hover:text-ai-readout"
              }`}
            >
              <span className="block text-xs font-medium leading-tight">{label}</span>
              {port && (
                <span className="block text-[10px] font-mono text-ai-label/60 mt-0.5">:{port}</span>
              )}
              <span
                className={`absolute top-2 right-2 w-2 h-2 rounded-full transition-all ${
                  active ? "bg-ai-signal" : "bg-ai-label/30 group-hover:bg-ai-label/50"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* ── Endpoint ────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <SectionLabel text={t("ai.endpoint")} />
        <input
          type="text"
          value={apiUrl}
          onChange={(e) => {
            setApiUrl(e.target.value);
            setTestState("idle");
          }}
          placeholder="http://127.0.0.1:11434/v1"
          className="w-full bg-ai-panel border border-ai-rail rounded-lg px-3 py-2.5 text-sm font-mono text-ai-readout outline-none focus:border-ai-signal/60 transition-colors placeholder:text-ai-label/30"
        />
        {testState !== "idle" && (
          <div
            className={`flex items-center gap-1.5 text-[11px] font-mono ${
              testState === "ok"
                ? "text-ai-live"
                : testState === "fail"
                  ? "text-ai-fail"
                  : "text-ai-label"
            }`}
          >
            {testState === "ok" && <Check size={11} />}
            {testState === "fail" && <X size={11} />}
            {testState === "testing" && <Loader size={11} className="animate-spin" />}
            {testMsg}
          </div>
        )}
      </section>

      {/* ── API Key ─────────────────────────────────────── */}
      {showApiKey && (
        <section className="flex flex-col gap-2">
          <SectionLabel text={t("ai.api_key")} />
          <div className="flex items-center bg-ai-panel border border-ai-rail rounded-lg overflow-hidden focus-within:border-ai-signal/60 transition-colors">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={currentPreset?.apiKeyHint ?? "••••••••••••••••"}
              className="flex-1 bg-transparent px-3 py-2.5 text-sm font-mono text-ai-readout outline-none placeholder:text-ai-label/30"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="px-3 py-2.5 text-ai-label hover:text-ai-readout transition-colors"
              aria-label={showKey ? t("ai.hide_key") : t("ai.show_key")}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </section>
      )}

      {/* ── Test (cloud) or Scan (local, collapsed) ─────── */}
      {isLocal ? (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setScanOpen((v) => !v)}
            className="flex items-center justify-between px-3 py-2 rounded-lg bg-ai-panel border border-ai-rail text-ai-label hover:text-ai-readout hover:border-ai-signal/30 transition-all text-xs font-medium"
          >
            <span className="flex items-center gap-2">
              <Search size={12} />
              {t("provider.scan_collapsed")}
            </span>
            <ChevronDown
              size={14}
              className={`transition-transform ${scanOpen ? "rotate-180" : ""}`}
            />
          </button>

          {scanOpen && (
            <div className="flex flex-col gap-3 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-ai-label uppercase tracking-wider">
                  {t("ai.scan_local")}
                </span>
                <button
                  onClick={handleScan}
                  disabled={scanState === "scanning"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ai-signal/15 border border-ai-signal/40 text-ai-signal text-xs font-medium hover:bg-ai-signal/25 transition-all disabled:opacity-40"
                >
                  {scanState === "scanning" ? (
                    <Loader size={12} className="animate-spin" />
                  ) : (
                    <Search size={12} />
                  )}
                  {scanState === "scanning" ? t("ai.scanning") : t("ai.scan")}
                </button>
              </div>

              <div className="flex items-center gap-2 bg-ai-panel border border-ai-rail rounded-lg p-1.5">
                <select
                  value={scanHost}
                  onChange={(e) => setScanHost(e.target.value)}
                  className="bg-transparent text-xs font-mono text-ai-readout outline-none cursor-pointer px-1.5 py-1 rounded hover:bg-ai-bg/50"
                >
                  <option value="127.0.0.1" className="bg-ai-panel">127.0.0.1</option>
                  <option value="localhost" className="bg-ai-panel">localhost</option>
                </select>
                <span className="text-ai-rail">·</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-ai-label">{t("provider.scan_from")}</span>
                  <input
                    type="number"
                    value={portFrom}
                    onChange={(e) => setPortFrom(Math.max(1, Number(e.target.value)))}
                    className="w-16 bg-transparent text-xs font-mono text-ai-readout outline-none px-1 py-0.5 rounded hover:bg-ai-bg/50 text-center"
                  />
                </div>
                <span className="text-ai-rail">—</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono text-ai-label">{t("provider.scan_to")}</span>
                  <input
                    type="number"
                    value={portTo}
                    onChange={(e) => setPortTo(Math.max(1, Number(e.target.value)))}
                    className="w-16 bg-transparent text-xs font-mono text-ai-readout outline-none px-1 py-0.5 rounded hover:bg-ai-bg/50 text-center"
                  />
                </div>
              </div>

              {scanState === "done" && scanResults.length === 0 && (
                <div className="flex flex-col items-center gap-1 py-4 text-center">
                  <Search size={20} className="text-ai-label/40" />
                  <p className="text-xs font-mono text-ai-label">
                    {t("provider.scan_empty", { host: scanHost, range: `${portFrom}-${portTo}` })}
                  </p>
                  <p className="text-[10px] font-mono text-ai-label/60">{t("provider.scan_hint")}</p>
                </div>
              )}

              {scanResults.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] font-mono text-ai-label uppercase tracking-wider">
                    {t("provider.scan_results", { count: scanResults.length })}
                  </div>
                  {scanResults.map((ep) => (
                    <button
                      key={ep.port}
                      onClick={() => handleEndpointSelect(ep)}
                      className={`group flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all ${
                        apiUrl === ep.url
                          ? "border-ai-signal bg-ai-signal/10"
                          : "border-ai-rail bg-ai-panel hover:border-ai-signal/40"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-2 h-2 rounded-full ${apiUrl === ep.url ? "bg-ai-signal" : "bg-ai-label/40"}`}
                        />
                        <div>
                          <span className="font-mono text-sm text-ai-readout">:{ep.port}</span>
                          <span className="ml-2 text-[11px] font-mono text-ai-label uppercase tracking-wide">
                            {ep.vendor}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {ep.models.length > 0 && (
                          <span className="text-[10px] font-mono text-ai-label bg-ai-bg/60 px-1.5 py-0.5 rounded">
                            {ep.models.length} {t("ai.models")}
                          </span>
                        )}
                        {apiUrl === ep.url && <Check size={12} className="text-ai-signal" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={testConnection}
          disabled={testState === "testing" || !apiUrl}
          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-ai-rail bg-ai-panel text-xs font-medium text-ai-label hover:border-ai-signal/50 hover:text-ai-readout transition-all disabled:opacity-40"
        >
          {testState === "testing" ? <Loader size={12} className="animate-spin" /> : <Zap size={12} />}
          {testState === "testing" ? t("ai.testing") : t("ai.test_connection")}
        </button>
      )}

      {/* ── Model ───────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionLabel text={t("ai.model")} />
          {models.length > 0 && (
            <button
              onClick={() => fetchModels(apiUrl, apiKey)}
              disabled={loadingModels}
              className="text-[10px] font-mono text-ai-label hover:text-ai-signal transition-colors flex items-center gap-1 disabled:opacity-40"
            >
              {loadingModels ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              {t("ai.refresh_models")}
            </button>
          )}
        </div>

        {loadingModels ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-ai-panel border border-ai-rail rounded-lg text-xs font-mono text-ai-label">
            <Loader size={12} className="animate-spin" />
            {t("ai.loading_models")}
          </div>
        ) : models.length > 0 && !useModelInput ? (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <select
                value={selectedModel}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  handleApply({ model: e.target.value });
                }}
                className="w-full appearance-none bg-ai-panel border border-ai-rail rounded-lg px-3 py-2.5 pr-9 text-sm font-mono text-ai-readout outline-none cursor-pointer hover:border-ai-signal/40 transition-colors"
              >
                {models.map((m) => (
                  <option key={m} value={m} className="bg-ai-panel text-ai-readout">
                    {m}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ai-label pointer-events-none"
              />
            </div>
            <button
              onClick={() => setUseModelInput(true)}
              className="text-[10px] font-mono text-ai-label hover:text-ai-readout px-2 py-1 rounded border border-ai-rail hover:border-ai-signal/40 transition-all whitespace-nowrap"
            >
              {t("provider.type_model")}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={modelInput}
              onChange={(e) => {
                setModelInput(e.target.value);
                handleApply({ model: e.target.value });
              }}
              placeholder={t("ai.model_placeholder")}
              className="flex-1 bg-ai-panel border border-ai-rail rounded-lg px-3 py-2.5 text-sm font-mono text-ai-readout outline-none focus:border-ai-signal/60 transition-colors placeholder:text-ai-label/30"
            />
            {models.length > 0 && (
              <button
                onClick={() => setUseModelInput(false)}
                className="text-[10px] font-mono text-ai-label hover:text-ai-readout px-2 py-1 rounded border border-ai-rail hover:border-ai-signal/40 transition-all whitespace-nowrap"
              >
                {t("provider.list_model")}
              </button>
            )}
          </div>
        )}
      </section>

      <p className="text-[10px] font-mono text-ai-label/60 italic">{t("ai.change_next_turn")}</p>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-mono text-ai-label uppercase tracking-[0.15em]">
      <span>{text}</span>
    </div>
  );
}