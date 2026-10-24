// ConnectionForm — create/edit form for a connection.
//
// State is fully local until the user presses Save — no side effects on
// input changes.  This is the central fix for the previous "every keystroke
// reconfigures the backend" bug.  Tabs between local/cloud only swap the
// field set; the actual mode (create vs edit) is preserved.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { LocalFormFields, type LocalFormValue } from "./LocalFormFields";
import { CloudFormFields, type CloudFormValue } from "./CloudFormFields";
import {
  createConnection,
  testConnection,
  updateConnection,
  listModels,
} from "../../../lib/api/connections";
import type {
  ApiFormat,
  CloudProviderInfo,
  ConnectionKind,
  ConnectionSummary,
  ConnectionTestResult,
} from "../../../lib/protocol";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  kind: ConnectionKind;
  existing: ConnectionSummary | null;
  cloudProviders: CloudProviderInfo[];
  onSaved: (conn: ConnectionSummary) => void;
  onCancel: () => void;
}

export function ConnectionForm({ mode, kind, existing, cloudProviders, onSaved, onCancel }: Props) {
  const { t } = useTranslation();

  // Local form values.  Start from a clean slate for create, hydrate
  // from `existing` for edit (no model list, since we re-probe live).
  const [local, setLocal] = useState<LocalFormValue>(() =>
    mode === "edit" && existing
      ? {
          name: existing.name,
          api_url: existing.api_url,
          api_format: (existing.api_format as ApiFormat) || "openai",
          vendor_detected: existing.vendor_detected,
          models: [],
        }
      : { name: "", api_url: "http://127.0.0.1:11434/v1", api_format: "openai", vendor_detected: "", models: [] },
  );

  const [cloud, setCloud] = useState<CloudFormValue>(() =>
    mode === "edit" && existing
      ? {
          name: existing.name,
          api_url: existing.api_url,
          api_format: "openai",
          api_key: "",
          vendor_detected: existing.vendor_detected,
        }
      : { name: "", api_url: "", api_format: "openai", api_key: "", vendor_detected: "" },
  );

  const [testState, setTestState] = useState<{
    running: boolean;
    result: ConnectionTestResult | null;
    error: string | null;
  }>({ running: false, result: null, error: null });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset test state when the user edits the URL/key after a probe.
  useEffect(() => {
    setTestState({ running: false, result: null, error: null });
  }, [local.api_url, local.api_format, cloud.api_url, cloud.api_key]);

  const handleTest = async () => {
    setTestState({ running: true, result: null, error: null });
    const apiUrl = kind === "local" ? local.api_url : cloud.api_url;
    const apiKey = kind === "local" ? "" : cloud.api_key;
    if (!apiUrl.trim()) {
      setTestState({ running: false, result: null, error: t("connections.endpoint_required") });
      return;
    }
    try {
      const result = await testConnection(apiUrl, apiKey);
      // If the endpoint exposes models, also remember them locally so the
      // Save step persists them — saves a second round-trip on Activate.
      if (result.ok && kind === "local" && result.models.length > 0) {
        setLocal((cur) => ({
          ...cur,
          models: result.models,
          vendor_detected: result.vendor || cur.vendor_detected,
        }));
      }
      setTestState({ running: false, result, error: null });
    } catch (err) {
      setTestState({ running: false, result: null, error: (err as Error).message });
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (kind === "local") {
        if (!local.name.trim() || !local.api_url.trim()) {
          setSaveError(t("connections.name_endpoint_required"));
          return;
        }
        // Best-effort refresh of model list before saving so the user
        // doesn't see 0 models if they forgot to hit Test.
        let models = local.models;
        if (models.length === 0) {
          try {
            models = await listModels(local.api_url);
          } catch {
            models = [];
          }
        }
        const payload = {
          kind: "local" as const,
          name: local.name.trim(),
          api_url: local.api_url.trim(),
          api_format: local.api_format,
          vendor_detected: local.vendor_detected,
          models,
        };
        const conn =
          mode === "edit" && existing
            ? await updateConnection(existing.id, payload)
            : await createConnection(payload);
        onSaved(conn);
      } else {
        if (!cloud.name.trim() || !cloud.api_url.trim()) {
          setSaveError("name + endpoint required");
          return;
        }
        if (!cloud.api_key.trim()) {
          setSaveError("API key is required for cloud connections");
          return;
        }
        const payload = {
          kind: "cloud" as const,
          name: cloud.name.trim(),
          api_url: cloud.api_url.trim(),
          api_format: "openai" as const,
          api_key: cloud.api_key,
          vendor_detected: cloud.vendor_detected,
          models: [],
        };
        const conn =
          mode === "edit" && existing
            ? await updateConnection(existing.id, payload)
            : await createConnection(payload);
        onSaved(conn);
      }
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onCancel}
        className="flex items-center gap-1.5 self-start text-xs text-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft size={12} />
        {t("connections.cancel")}
      </button>

      {kind === "local" ? (
        <LocalFormFields
          value={local}
          onChange={setLocal}
          testState={testState}
          onTest={handleTest}
        />
      ) : (
        <CloudFormFields
          value={cloud}
          onChange={setCloud}
          providers={cloudProviders}
          testState={testState}
          onTest={handleTest}
        />
      )}

      {saveError && <p className="text-[11px] text-err">{saveError}</p>}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs text-muted hover:text-foreground hover:bg-fg/5 transition-colors"
        >
          {t("connections.cancel")}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-md border border-accent bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors disabled:opacity-50"
        >
          {t("connections.save")}
        </button>
      </div>
    </div>
  );
}