import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScanSearch, Loader2, X, ChevronRight, ArrowRight } from "lucide-react";
import { scanLocal, type ScanResult } from "../../../lib/api/connections";

interface Props {
  onPick: (result: ScanResult) => void;
}

const DEFAULT_FROM = 8000;
const DEFAULT_TO = 12300;

export function ScanPanel({ onPick }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("127.0.0.1");
  const [fromPort, setFromPort] = useState(DEFAULT_FROM);
  const [toPort, setToPort] = useState(DEFAULT_TO);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [modelSearch, setModelSearch] = useState("");

  const handleScan = async () => {
    setError(null);
    setResults([]);
    setExpandedIndex(null);
    const ac = new AbortController();
    setController(ac);
    setScanning(true);
    try {
      const list = await scanLocal(host, fromPort, toPort, ac.signal);
      setResults(list);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setScanning(false);
      setController(null);
    }
  };

  const handleCancel = () => {
    controller?.abort();
  };

  const toggleExpand = (idx: number) => {
    setExpandedIndex((prev) => (prev === idx ? null : idx));
    setModelSearch("");
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs text-fg hover:text-accent transition-colors self-start"
      >
        <ScanSearch size={12} />
        {open ? t("connections.cancel") : t("connections.scan")}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 py-3 rounded-lg bg-surface border border-border">
          <p className="text-[10px] text-muted/70">{t("connections.scan_help")}</p>
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px] text-muted">{t("connections.host")}</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="bg-elevated text-foreground border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent-dim"
              />
            </div>
            <div className="flex flex-col gap-1 w-20">
              <label className="text-[10px] text-muted">{t("provider.scan_from")}</label>
              <input
                type="number"
                value={fromPort}
                onChange={(e) => setFromPort(parseInt(e.target.value, 10) || DEFAULT_FROM)}
                className="bg-elevated text-foreground border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent-dim"
              />
            </div>
            <div className="flex flex-col gap-1 w-20">
              <label className="text-[10px] text-muted">{t("provider.scan_to")}</label>
              <input
                type="number"
                value={toPort}
                onChange={(e) => setToPort(parseInt(e.target.value, 10) || DEFAULT_TO)}
                className="bg-elevated text-foreground border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-accent-dim"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!scanning ? (
              <button
                onClick={handleScan}
                disabled={!host || fromPort > toPort}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent/40 text-accent text-xs font-medium hover:bg-accent/10 transition-colors disabled:opacity-50"
              >
                <ScanSearch size={12} />
                {t("connections.scan")}
              </button>
            ) : (
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-muted text-xs font-medium hover:bg-white/5 transition-colors"
              >
                <X size={12} />
                {t("provider.scan_cancel")}
              </button>
            )}
            {scanning && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <Loader2 size={11} className="animate-spin" />
                {t("connections.scanning", { host, from: fromPort, to: toPort })}
              </span>
            )}
          </div>
          {error && <p className="text-[11px] text-err">{error}</p>}
          {!scanning && results.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-[10px] text-muted/80">
                {t("connections.scan_results_count", { count: results.length })}
              </p>
              {results.map((r, idx) => {
                const isExpanded = expandedIndex === idx;
                const filtered =
                  modelSearch && isExpanded
                    ? r.models.filter((m) =>
                        m.toLowerCase().includes(modelSearch.toLowerCase()),
                      )
                    : r.models;

                return (
                  <div key={`${r.port}-${r.url}`} className="flex flex-col">
                    <button
                      onClick={() => toggleExpand(idx)}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-elevated border border-border hover:border-accent/40 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronRight
                          size={11}
                          className={`text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                        <span className="text-[11px] font-mono text-foreground">
                          {host}:{r.port}
                        </span>
                        <span className="text-[10px] text-muted">{r.vendor}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted">
                          {r.models.length} {t("ai.models", { defaultValue: "models" })}
                        </span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onPick(r);
                          }}
                          className="text-accent hover:text-accent-dim transition-colors"
                        >
                          <ArrowRight size={12} />
                        </span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="ml-4 mt-1 px-2 py-2 rounded-md bg-surface/40 border border-border/50 max-h-[220px] overflow-y-auto scrollbar-thin flex flex-col gap-1">
                        {r.models.length > 10 && (
                          <input
                            type="text"
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            placeholder={t("connections.search_models", {
                              defaultValue: "Search models…",
                            })}
                            className="bg-elevated text-foreground border border-border rounded-md px-2 py-1 text-[10px] outline-none focus:border-accent-dim"
                          />
                        )}
                        {filtered.length > 0 ? (
                          filtered.map((m) => (
                            <span
                              key={m}
                              className="text-[11px] font-mono text-foreground/80"
                            >
                              {m}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-muted/60">
                            {t("connections.no_models_match", {
                              defaultValue: "No models match",
                            })}
                          </span>
                        )}
                        <button
                          onClick={() => onPick(r)}
                          className="self-start mt-1 flex items-center gap-1 text-[10px] text-accent hover:text-accent-dim transition-colors"
                        >
                          <ArrowRight size={11} />
                          {t("connections.use_server", {
                            defaultValue: "Use this server",
                          })}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!scanning && results.length === 0 && !error && (
            <p className="text-[10px] text-muted/60">{t("connections.scan_empty")}</p>
          )}
        </div>
      )}
    </div>
  );
}
