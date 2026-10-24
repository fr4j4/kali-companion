import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, ExternalLink, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { TextField } from "../fields";
import { TestResultBlock } from "./LocalFormFields";
import { verifyApiKey } from "../../../lib/api/connections";
import type { CloudProviderInfo, ConnectionTestResult } from "../../../lib/protocol";

export interface CloudFormValue {
  name: string;
  api_url: string;
  api_format: "openai" | "custom";
  api_key: string;
  vendor_detected: string;
}

interface Props {
  value: CloudFormValue;
  onChange: (v: CloudFormValue) => void;
  providers: CloudProviderInfo[];
  testState: { running: boolean; result: ConnectionTestResult | null; error: string | null };
  onTest: () => void;
}

export function CloudFormFields({ value, onChange, providers, testState, onTest }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [keyState, setKeyState] = useState<{
    running: boolean;
    ok: boolean | null;
    detail: string;
  }>({ running: false, ok: null, detail: "" });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) => p.id.includes(q) || p.name.toLowerCase().includes(q) || p.notes.toLowerCase().includes(q),
    );
  }, [providers, query]);

  const handleSelect = (p: CloudProviderInfo) => {
    setSelectedId(p.id);
    if (p.id === "openai_compatible") {
      onChange({ ...value, name: value.name || t("connections.openai_compatible") });
      return;
    }
    onChange({
      ...value,
      api_url: p.api_url,
      name: value.name || p.name,
      vendor_detected: p.id,
      api_format: "openai",
    });
  };

  const handleValidateKey = async () => {
    if (!value.api_url || !value.api_key) return;
    setKeyState({ running: true, ok: null, detail: "" });
    try {
      const res = await verifyApiKey(value.api_url, value.api_key);
      setKeyState({ running: false, ok: res.ok, detail: res.detail });
    } catch (err) {
      setKeyState({ running: false, ok: false, detail: (err as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={t("connections.name")}
        value={value.name}
        onChange={(name) => onChange({ ...value, name })}
        placeholder={t("connections.name_placeholder_cloud")}
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted">{t("connections.pick_provider")}</label>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("connections.search_provider") as string}
            className="w-full bg-surface text-foreground border border-border rounded-lg pl-7 pr-2.5 py-1.5 text-xs outline-none focus:border-accent-dim"
          />
        </div>
        <div className="flex flex-col gap-1 max-h-44 overflow-y-auto stage-scroll">
          {filtered.map((p) => {
            const selected = selectedId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors text-left ${
                  selected
                    ? "border-accent/40 bg-accent/10"
                    : "border-border bg-surface hover:border-accent/30"
                }`}
              >
                {selected ? (
                  <Check size={12} className="text-accent shrink-0" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground">{p.name}</div>
                  {p.api_url && (
                    <div className="text-[10px] text-muted font-mono truncate">{p.api_url}</div>
                  )}
                </div>
                {p.docs_url && (
                  <a
                    href={p.docs_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted hover:text-accent shrink-0"
                    title={t("connections.docs_link")}
                  >
                    <ExternalLink size={11} />
                  </a>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <TextField
        label={t("ai.endpoint")}
        value={value.api_url}
        onChange={(api_url) => onChange({ ...value, api_url })}
        placeholder="https://api.openai.com/v1"
        helperText={t("connections.endpoint_hint")}
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted">{t("connections.api_key")}</label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={value.api_key}
              onChange={(e) => onChange({ ...value, api_key: e.target.value })}
              placeholder="sk-…"
              className="w-full bg-surface text-foreground border border-border rounded-lg pl-2.5 pr-8 py-2 text-sm outline-none transition-colors focus:border-accent-dim"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors"
              tabIndex={-1}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={handleValidateKey}
            disabled={keyState.running || !value.api_url || !value.api_key}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg border border-accent/40 text-accent text-[11px] font-medium hover:bg-accent/10 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {keyState.running ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Check size={11} />
            )}
            {t("connections.validate_key", { defaultValue: "Validate" })}
          </button>
        </div>
        {keyState.ok === true && (
          <p className="text-[11px] text-ok">
            {t("connections.key_valid", { defaultValue: "✓ Key is valid" })}
          </p>
        )}
        {keyState.ok === false && (
          <p className="text-[11px] text-err">
            {t("connections.key_invalid", { defaultValue: "✗ Invalid key: {{reason}}", reason: keyState.detail })}
          </p>
        )}
      </div>

      <TestResultBlock state={testState} onTest={onTest} />
    </div>
  );
}
