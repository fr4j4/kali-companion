// JobsPanel — long jobs Kali runs in the background: what each one is, its state in words with
// an icon, a progress bar while it runs, its duration when it ends, and its log on demand.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Check, X, Ban, Clock, Image as ImageIcon, Cog, ChevronDown, ChevronRight } from "lucide-react";
import { Modal } from "./ui/Modal";
import type { JobItem } from "../hooks/useChat";

interface Props {
  open: boolean;
  onClose: () => void;
  jobs: Map<string, JobItem>;
  onCancelJob: (id: string) => void;
  onGetLogs: (id: string) => void;
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const secs = Math.floor((endMs - startMs) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running": return <Loader2 size={14} className="animate-spin text-accent" aria-hidden="true" />;
    case "done": return <Check size={14} className="text-ok" aria-hidden="true" />;
    case "error": return <X size={14} className="text-err" aria-hidden="true" />;
    case "cancelled": return <Ban size={14} className="text-muted" aria-hidden="true" />;
    default: return <Clock size={14} className="text-muted" aria-hidden="true" />;
  }
}

function JobTypeIcon({ type }: { type: string }) {
  return type.startsWith("dota_image") ? <ImageIcon size={16} aria-hidden="true" /> : <Cog size={16} aria-hidden="true" />;
}

export function JobsPanel({ open, onClose, jobs, onCancelJob, onGetLogs }: Props) {
  const { t } = useTranslation();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const jobList = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const runningCount = jobList.filter((j) => j.status === "running").length;

  return (
    <Modal open={open} onClose={onClose} title={runningCount > 0 ? `${t("jobs.title")} (${t("jobs.active", { count: runningCount })})` : t("jobs.title") as string}>
      {jobList.length === 0 && (
        <p className="kw-empty">{t("jobs.empty")}</p>
      )}
      <div className="kw-jobs">
        {jobList.map((job) => {
          const open = expandedJob === job.id;
          return (
            <div key={job.id} className={`kw-job is-${job.status}`}>
              <div className="kw-job-row">
                <button
                  type="button"
                  className="kw-job-main"
                  aria-expanded={open}
                  onClick={() => {
                    if (open) setExpandedJob(null);
                    else { setExpandedJob(job.id); onGetLogs(job.id); }
                  }}
                >
                  <span className="kw-job-tile"><JobTypeIcon type={job.type} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="kw-job-name">{job.type}</span>
                    <span className="kw-job-state">
                      <StatusIcon status={job.status} />
                      {t(`jobs.status.${job.status}`, { defaultValue: job.status })}
                      <span className="kw-mono">{job.status === "running" ? `${job.progress}%` : formatDuration(job.started_at, job.finished_at)}</span>
                    </span>
                  </span>
                  {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                </button>
                {job.status === "running" && (
                  <button type="button" className="v2-btn is-danger" onClick={() => onCancelJob(job.id)}>
                    {t("jobs.cancel")}
                  </button>
                )}
              </div>
              {job.status === "running" && (
                <div className="kw-break-track kw-job-bar" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${job.progress}%` }} />
                </div>
              )}
              {open && (
                <div className="kw-job-log">
                  {job.error && <p className="text-err">{job.error}</p>}
                  {job.logs && job.logs.length > 0 ? (
                    <pre className="scrollbar-thin">{job.logs.join("\n")}</pre>
                  ) : (
                    <p className="kw-dim">{t("jobs.no_logs")}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}