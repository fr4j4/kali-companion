import type { ArtifactEvent } from "../../../lib/protocol";

interface Props {
  content?: unknown;
  windowType: string;
}

const SPINNER_LABELS: Record<string, string> = {
  mermaid: "Generando diagrama\u2026",
  json: "Generando \u00e1rbol JSON\u2026",
  table: "Generando tabla\u2026",
  checklist: "Generando checklist\u2026",
  chart: "Generando chart\u2026",
  quiz: "Generando quiz\u2026",
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
  if (!isStreaming(content)) return null;
  const label = SPINNER_LABELS[windowType] ?? "Generando\u2026";
  const icon = SPINNER_ICONS[windowType] ?? "\u25CF";
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 min-h-0">
      <div className="text-2xl opacity-30">{icon}</div>
      <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}