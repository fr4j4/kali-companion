// LocalFormFields — fields for a "local" connection (endpoint + format).
//
// Owns its own state via the parent's `value`/`onChange` contract.  The
// parent decides when to send the data to the server (on Save).

import { useTranslation } from "react-i18next";
import { TextField, SelectField } from "../fields";
import { ScanPanel } from "./ScanPanel";
import type { ApiFormat, ConnectionTestResult } from "../../../lib/protocol";
import type { ScanResult } from "../../../lib/api/connections";

export interface LocalFormValue {
  name: string;
  api_url: string;
  api_format: ApiFormat;
  vendor_detected: string;
  models: string[];
}

interface Props {
  value: LocalFormValue;
  onChange: (v: LocalFormValue) => void;
  testState: { running: boolean; result: ConnectionTestResult | null; error: string | null };
  onTest: () => void;
}

const FORMATS: Array<{ id: ApiFormat; key: string }> = [
  { id: "openai", key: "connections.format_openai" },
  { id: "ollama", key: "connections.format_ollama" },
  { id: "llamacpp", key: "connections.format_llamacpp" },
  { id: "lmstudio", key: "connections.format_lmstudio" },
  { id: "vllm", key: "connections.format_vllm" },
  { id: "custom", key: "connections.format_custom" },
];

// Default host/port → URL templates per format.  Used when the user picks
// a format for the first time so the URL field has a sensible placeholder.
const FORMAT_DEFAULTS: Record<ApiFormat, string> = {
  openai: "http://127.0.0.1:11434/v1",
  ollama: "http://127.0.0.1:11434",
  llamacpp: "http://127.0.0.1:8080/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  vllm: "http://127.0.0.1:8000/v1",
  custom: "http://127.0.0.1:8000/v1",
};

export function LocalFormFields({ value, onChange, testState, onTest }: Props) {
  const { t } = useTranslation();

  const handleFormatChange = (fmt: string) => {
    const f = fmt as ApiFormat;
    onChange({
      ...value,
      api_format: f,
      api_url: FORMAT_DEFAULTS[f],
    });
  };

  const handleScanPick = (r: ScanResult) => {
    onChange({
      ...value,
      api_url: r.url,
      vendor_detected: r.vendor,
      models: r.models,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={t("connections.name")}
        value={value.name}
        onChange={(name) => onChange({ ...value, name })}
        placeholder={t("connections.name_placeholder_local")}
      />

      <SelectField
        label={t("connections.api_format")}
        value={value.api_format}
        onChange={handleFormatChange}
        options={FORMATS.map((f) => ({ value: f.id, label: t(f.key) }))}
      />

      <TextField
        label={t("ai.endpoint")}
        value={value.api_url}
        onChange={(api_url) => onChange({ ...value, api_url })}
        placeholder={FORMAT_DEFAULTS[value.api_format]}
        helperText={t("connections.endpoint_hint")}
      />

      <ScanPanel onPick={handleScanPick} />

      <TestResultBlock state={testState} onTest={onTest} />
    </div>
  );
}

export function TestResultBlock({
  state,
  onTest,
}: {
  state: { running: boolean; result: ConnectionTestResult | null; error: string | null };
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={onTest}
        disabled={state.running}
        className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent/40 text-accent text-xs font-medium hover:bg-accent/10 transition-colors disabled:opacity-50"
      >
        {state.running ? t("connections.testing") : t("connections.test")}
      </button>
      {state.error && (
        <p className="text-[11px] text-err">{t("connections.test_failed", { reason: state.error })}</p>
      )}
      {state.result && state.result.ok && (
        <p className="text-[11px] text-ok">
          {state.result.models.length > 0
            ? t("connections.test_ok_with_models", { count: state.result.models.length })
            : t("connections.test_ok_no_models")}
          {state.result.vendor && state.result.vendor !== "openai-compatible" && (
            <span className="text-muted/70"> · {state.result.vendor}</span>
          )}
        </p>
      )}
      {state.result && !state.result.ok && (
        <p className="text-[11px] text-err">
          {t("connections.test_failed", { reason: state.result.detail || "?" })}
        </p>
      )}
    </div>
  );
}