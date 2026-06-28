import { useTranslation } from "react-i18next";
import type { ArtifactEvent } from "../../../lib/protocol";

interface Props {
  content?: unknown;
  windowType: string;
}

const SPINNER_LABEL_KEYS: Record<string, string> = {
  mermaid: "window.streaming.mermaid",
  json: "window.streaming.json",
  table: "window.streaming.table",
  checklist: "window.streaming.checklist",
  chart: "window.streaming.chart",
  quiz: "window.streaming.quiz",
};

const SPINNER_ICONS: Record<string, string> = {
  mermaid: "\u25C7",
  json: "{}",
  table: "\u2630",
  checklist: "\u2611",
  chart: "\u25F2",
  quiz: "?",
};

export function isStreaming(content: unknown): boolean {
  const event = content as ArtifactEvent | undefined;
  return event?.phase === "streaming";
}

export function StreamingSpinner({ content, windowType }: Props) {
  const { t } = useTranslation();
  if (!isStreaming(content)) return null;
  const label = t(SPINNER_LABEL_KEYS[windowType] ?? "window.streaming.default") as string;
  const icon = SPINNER_ICONS[windowType] ?? "\u25CF";
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-0">
      <div className="text-2xl opacity-30">{icon}</div>
      <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}