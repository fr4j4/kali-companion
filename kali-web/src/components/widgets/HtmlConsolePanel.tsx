import { useEffect, useRef } from "react";

export interface ConsoleEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  message: string;
  timestamp: number;
}

interface Props {
  logs: ConsoleEntry[];
  onClear?: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  log: "text-white/80",
  info: "text-blue-300",
  warn: "text-yellow-300",
  error: "text-red-300",
  debug: "text-white/40",
};

const LEVEL_BADGES: Record<string, string> = {
  log: "bg-white/10",
  info: "bg-blue-500/20",
  warn: "bg-yellow-500/20",
  error: "bg-red-500/20",
  debug: "bg-white/5",
};

export function HtmlConsolePanel({ logs, onClear }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d0d0d]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/8 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Console</span>
          <span className="text-[10px] text-muted">{logs.length} entries</span>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="text-[10px] text-muted hover:text-fg transition px-2 py-0.5 rounded hover:bg-white/10"
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5 scrollbar-thin">
        {logs.length === 0 && (
          <div className="text-white/20 italic text-center pt-6">No console output</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className={`flex items-start gap-2 ${LEVEL_COLORS[entry.level] ?? "text-white/80"}`}>
            <span
              className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none ${LEVEL_BADGES[entry.level] ?? "bg-white/10"}`}
            >
              {entry.level}
            </span>
            <span className="whitespace-pre-wrap break-all leading-[1.4]">{entry.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
