// AIConfigModal — AI provider configuration with instrument-panel aesthetics.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  Loader,
  RefreshCw,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useFocusTrap } from "../hooks/useFocusTrap";
import {
  type LocalEndpoint,
  type ProviderPreset,
  findPresetById,
  PROVIDER_PRESETS,
} from "../lib/aiPresets";
import type { SettingsEvent, StatusEvent } from "../lib/protocol";

interface Props {
  open: boolean;
  onClose: () => void;
  systemStatus: StatusEvent | null;
  onUpdate: (patch: Partial<SettingsEvent>) => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";
type ScanState = "idle" | "scanning" | "done";

export function AIConfigModal({ open, onClose, systemStatus, onUpdate }: Props) {
  const { t, i18n } = useTranslation();
  const isEs = i18n.language === "es";
  const trapRef = useFocusTrap(open);
  useBodyScrollLock(open);

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

  const [testState, setTestState] = useState<TestState>("idle");
  const [testMsg, setTestMsg] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);

  const scanTimerRef = useRef<number | null>(null);

  const currentPreset: ProviderPreset | undefined = findPresetById(presetId);
  const isLocal = currentPreset?.kind === "local";
  const showApiKey = currentPreset?.requiresApiKey || apiKey.length > 0;

  useEffect(() => {
    if (!open || !systemStatus) return;
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
  }, [open, systemStatus]);

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
        `/llm/models?api_url=${encodeURIComponent(url)}&api_key=${encodeURIComponent(key)}`
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
        `/llm/models?api_url=${encodeURIComponent(apiUrl)}&api_key=${encodeURIComponent(apiKey)}`
      );
      const data = await res.json();
      const list: string[] = data.models ?? [];
      if (res.ok && list.length > 0) {
        setModels(list);
        if (!selectedModel) setSelectedModel(list[0]);
        setTestState("ok");
        setTestMsg(isEs ? `${list.length} modelos encontrados` : `${list.length} models found`);
      } else if (res.ok) {
        setTestState("ok");
        setTestMsg(isEs ? "Conectado, sin modelos" : "Connected, no models");
        setUseModelInput(true);
      } else {
        setTestState("fail");
        setTestMsg(data.detail ?? (isEs ? "Conexión fallida" : "Connection failed"));
      }
    } catch (e) {
      setTestState("fail");
      setTestMsg(String(e));
    }
  }, [apiUrl, apiKey, selectedModel, isEs]);

  const handleScan = useCallback(async () => {
    setScanState("scanning");
    setScanResults([]);
    try {
      const res = await fetch(
        `/llm/scan?host=${encodeURIComponent(scanHost)}&from_port=${portFrom}&to_port=${portTo}`
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
          fetchModels(preset.apiUrl, "");
        }
      }
    },
    [fetchModels]
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
        setTestMsg(`${endpoint.vendor} :${endpoint.port} — ${endpoint.models.length} ${isEs ? "modelos" : "models"}`);
      } else {
        setModels([]);
        setUseModelInput(true);
        setTestState("ok");
        setTestMsg(`${endpoint.vendor} :${endpoint.port}`);
      }
    },
    [isEs]
  );

  const handleApply = useCallback(() => {
    setSaving(true);
    const model = useModelInput ? modelInput : selectedModel;
    onUpdate({
      llm_model: model,
      llm_api_url: apiUrl,
      llm_api_key: apiKey,
      llm_provider: presetId === "custom" ? "direct" : presetId,
    });
    window.setTimeout(() => {
      setSaving(false);
      onClose();
    }, 100);
  }, [useModelInput, modelInput, selectedModel, apiUrl, apiKey, presetId, onUpdate, onClose]);

  if (!open) return null;

  const model = useModelInput ? modelInput : selectedModel;
  const canApply = model.trim().length > 0 && apiUrl.trim().length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        className="ai-modal-enter bg-ai-bg border border-ai-rail rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
        role="dialog"
        aria-modal="true"
        aria-label={t("ai.title")}
      >
        {/* ── Header ────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ai-rail sticky top-0 bg-ai-bg z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-ai-signal/15 border border-ai-signal/30 flex items-center justify-center">
              <Cpu size={16} className="text-ai-signal" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ai-readout m-0 leading-tight">
                {t("ai.title")}
              </h2>
              <p className="text-[10px] font-mono text-ai-label m-0 leading-tight mt-0.5">
                {systemStatus?.llm_provider ?? "direct"} · {systemStatus?.llm_model ?? "—"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ai-label hover:text-ai-readout transition-colors p-1.5 rounded-lg hover:bg-ai-panel"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-6">

          {/* ── Provider ─────────────────────────────────── */}
          <section className="flex flex-col gap-2.5">
            <SectionLabel icon={<HardDrive size={10} />} text={isEs ? "Local" : "Local"} />
            <div className="grid grid-cols-3 gap-2">
              {PROVIDER_PRESETS.filter((p) => p.kind === "local").map((preset) => (
                <PresetButton
                  key={preset.id}
                  preset={preset}
                  isEs={isEs}
                  active={presetId === preset.id}
                  onClick={() => handlePresetSelect(preset.id)}
                />
              ))}
            </div>

            <SectionLabel icon={<Cloud size={10} />} text={isEs ? "Cloud" : "Cloud"} className="mt-1" />
            <div className="grid grid-cols-3 gap-2">
              {PROVIDER_PRESETS.filter((p) => p.kind === "cloud").map((preset) => (
                <PresetButton
                  key={preset.id}
                  preset={preset}
                  isEs={isEs}
                  active={presetId === preset.id}
                  onClick={() => handlePresetSelect(preset.id)}
                />
              ))}
            </div>
          </section>

          {/* ── Endpoint ─────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <SectionLabel text={t("ai.endpoint")} />
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => { setApiUrl(e.target.value); setTestState("idle"); }}
              placeholder="http://127.0.0.1:11434/v1"
              className="w-full bg-ai-panel border border-ai-rail rounded-lg px-3 py-2.5 text-sm font-mono text-ai-readout outline-none focus:border-ai-signal/60 transition-colors placeholder:text-ai-label/30"
            />

            {/* Connection status */}
            {testState !== "idle" && (
              <div className={`flex items-center gap-1.5 text-[11px] font-mono ${
                testState === "ok" ? "text-ai-live" : testState === "fail" ? "text-ai-fail" : "text-ai-label"
              }`}>
                {testState === "ok" && <Check size={11} />}
                {testState === "fail" && <X size={11} />}
                {testState === "testing" && <Loader size={11} className="animate-spin" />}
                {testMsg}
              </div>
            )}
          </section>

          {/* ── API Key ──────────────────────────────────── */}
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

          {/* ── Test / Scan ──────────────────────────────── */}
          <section className="flex flex-col gap-3">
            {isLocal ? (
              <>
                <div className="flex items-center justify-between">
                  <SectionLabel text={t("ai.scan_local")} />
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

                {/* Port range controls */}
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
                    <span className="text-[10px] font-mono text-ai-label">{isEs ? "desde" : "from"}</span>
                    <input
                      type="number"
                      value={portFrom}
                      onChange={(e) => setPortFrom(Math.max(1, Number(e.target.value)))}
                      className="w-16 bg-transparent text-xs font-mono text-ai-readout outline-none px-1 py-0.5 rounded hover:bg-ai-bg/50 text-center"
                    />
                  </div>
                  <span className="text-ai-rail">—</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono text-ai-label">{isEs ? "hasta" : "to"}</span>
                    <input
                      type="number"
                      value={portTo}
                      onChange={(e) => setPortTo(Math.max(1, Number(e.target.value)))}
                      className="w-16 bg-transparent text-xs font-mono text-ai-readout outline-none px-1 py-0.5 rounded hover:bg-ai-bg/50 text-center"
                    />
                  </div>
                </div>

                {/* Scan results */}
                {scanState === "done" && scanResults.length === 0 && (
                  <div className="flex flex-col items-center gap-1 py-4 text-center">
                    <Search size={20} className="text-ai-label/40" />
                    <p className="text-xs font-mono text-ai-label">
                      {isEs
                        ? `No se encontraron endpoints en ${scanHost}:${portFrom}-${portTo}`
                        : `No endpoints found on ${scanHost}:${portFrom}-${portTo}`}
                    </p>
                    <p className="text-[10px] font-mono text-ai-label/60">
                      {isEs ? "Asegúrate de que Ollama, llama.cpp u otro servidor esté corriendo" : "Make sure Ollama, llama.cpp or another server is running"}
                    </p>
                  </div>
                )}

                {scanResults.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[10px] font-mono text-ai-label uppercase tracking-wider">
                      {scanResults.length} {isEs ? "encontrados" : "found"}
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
                          <div className={`w-2 h-2 rounded-full ${apiUrl === ep.url ? "bg-ai-signal" : "bg-ai-label/40"}`} />
                          <div>
                            <span className="font-mono text-sm text-ai-readout">:{ep.port}</span>
                            <span className="ml-2 text-[11px] font-mono text-ai-label uppercase tracking-wide">{ep.vendor}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {ep.models.length > 0 && (
                            <span className="text-[10px] font-mono text-ai-label bg-ai-bg/60 px-1.5 py-0.5 rounded">
                              {ep.models.length} {isEs ? "modelos" : "models"}
                            </span>
                          )}
                          {apiUrl === ep.url && <Check size={12} className="text-ai-signal" />}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={testConnection}
                disabled={testState === "testing" || !apiUrl}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-ai-rail bg-ai-panel text-xs font-medium text-ai-label hover:border-ai-signal/50 hover:text-ai-readout transition-all disabled:opacity-40"
              >
                {testState === "testing" ? (
                  <Loader size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                {testState === "testing" ? t("ai.testing") : t("ai.test_connection")}
              </button>
            )}
          </section>

          {/* ── Model ────────────────────────────────────── */}
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
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full appearance-none bg-ai-panel border border-ai-rail rounded-lg px-3 py-2.5 pr-9 text-sm font-mono text-ai-readout outline-none cursor-pointer hover:border-ai-signal/40 transition-colors"
                  >
                    {models.map((m) => (
                      <option key={m} value={m} className="bg-ai-panel text-ai-readout">
                        {m}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ai-label pointer-events-none" />
                </div>
                <button
                  onClick={() => setUseModelInput(true)}
                  className="text-[10px] font-mono text-ai-label hover:text-ai-readout px-2 py-1 rounded border border-ai-rail hover:border-ai-signal/40 transition-all whitespace-nowrap"
                >
                  {isEs ? "Escribir" : "Type"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  placeholder={t("ai.model_placeholder")}
                  className="flex-1 bg-ai-panel border border-ai-rail rounded-lg px-3 py-2.5 text-sm font-mono text-ai-readout outline-none focus:border-ai-signal/60 transition-colors placeholder:text-ai-label/30"
                />
                {models.length > 0 && (
                  <button
                    onClick={() => setUseModelInput(false)}
                    className="text-[10px] font-mono text-ai-label hover:text-ai-readout px-2 py-1 rounded border border-ai-rail hover:border-ai-signal/40 transition-all whitespace-nowrap"
                  >
                    {isEs ? "Lista" : "List"}
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-ai-rail sticky bottom-0 bg-ai-bg">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-ai-label hover:text-ai-readout hover:bg-ai-panel transition-all"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleApply}
            disabled={saving || !canApply}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-ai-signal text-ai-bg hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-ai-signal/20"
          >
            {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            {t("ai.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ icon, text, className = "" }: { icon?: React.ReactNode; text: string; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[10px] font-mono text-ai-label uppercase tracking-[0.15em] ${className}`}>
      {icon}
      <span>{text}</span>
    </div>
  );
}

function PresetButton({
  preset,
  isEs,
  active,
  onClick,
}: {
  preset: ProviderPreset;
  isEs: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2.5 rounded-lg border text-left transition-all ${
        active
          ? "border-ai-signal bg-ai-signal/10 text-ai-readout shadow-sm shadow-ai-signal/10"
          : "border-ai-rail bg-ai-panel text-ai-label hover:border-ai-signal/30 hover:text-ai-readout"
      }`}
    >
      <span className="block text-[9px] font-mono uppercase tracking-wider mb-1 opacity-60">
        {preset.kind === "local" ? "↓ local" : "☁ cloud"}
      </span>
      <span className="block text-xs font-medium leading-tight">
        {isEs ? preset.labelEs : preset.label}
      </span>
    </button>
  );
}