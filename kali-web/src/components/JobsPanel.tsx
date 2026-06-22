import { useState } from "react";
import { useTranslation } from "react-i18next";
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

function statusIcon(status: string): string {
  switch (status) {
    case "running": return "🔄";
    case "done": return "✅";
    case "error": return "❌";
    case "cancelled": return "⊘";
    default: return "⏳";
  }
}

function jobTypeIcon(type: string): string {
  if (type.startsWith("dota_image")) return "🖼️";
  return "⚙️";
}

export function JobsPanel({ open, onClose, jobs, onCancelJob, onGetLogs }: Props) {
  const { t } = useTranslation();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const jobList = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const runningCount = jobList.filter((j) => j.status === "running").length;

  return (
    <Modal open={open} onClose={onClose} title={`Jobs${runningCount > 0 ? ` (${runningCount} active)` : ""}`}>
      {jobList.length === 0 && (
        <p className="text-muted text-sm text-center py-4">{t("jobs.empty")}</p>
      )}
      <div className="flex flex-col gap-2">
        {jobList.map((job) => (
          <div
            key={job.id}
            className="border border-border rounded-lg bg-surface overflow-hidden"
          >
            <div
              className="flex items-center gap-2 p-2 cursor-pointer hover:bg-elevated/50"
              onClick={() => {
                if (expandedJob === job.id) {
                  setExpandedJob(null);
                } else {
                  setExpandedJob(job.id);
                  onGetLogs(job.id);
                }
              }}
            >
              <span className="text-base shrink-0">{jobTypeIcon(job.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground truncate">{job.type}</span>
                  <span className="text-xs text-muted">{statusIcon(job.status)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {job.status === "running" && (
                    <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-300 rounded-full"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}
                  <span className="text-xs text-muted shrink-0">
                    {job.status === "running" ? `${job.progress}%` : formatDuration(job.started_at, job.finished_at)}
                  </span>
                </div>
              </div>
              {job.status === "running" && (
                <button
                  className="bg-transparent border border-err/30 text-err rounded-md px-2 py-1 text-xs cursor-pointer hover:bg-err/10 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelJob(job.id);
                  }}
                >
                  {t("jobs.cancel")}
                </button>
              )}
            </div>
            {expandedJob === job.id && (
              <div className="border-t border-border bg-elevated/30 p-2">
                {job.error && (
                  <p className="text-err text-xs mb-1">{job.error}</p>
                )}
                {job.logs && job.logs.length > 0 ? (
                  <pre className="text-xs text-muted font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {job.logs.join("\n")}
                  </pre>
                ) : (
                  <p className="text-muted text-xs italic">{t("jobs.no_logs")}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}