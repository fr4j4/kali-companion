import { useState, useEffect } from "react";
import { Gamepad2, Trash2, Copy } from "lucide-react";
import { gameAILogger, type GameAILogEntry } from "../../games/core/game-ai-logger";

const PALETTE = {
  out: "#22d3ee",
  in: "#a78bfa",
  muted: "#64748b",
  bg: "rgba(15, 23, 42, 0.9)",
  border: "rgba(124, 58, 237, 0.3)",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface Props {
  getSessionId?: () => string;
  sessionId?: string;
}

export function GameDebugPanel({ getSessionId, sessionId: staticSessionId }: Props) {
  const [entries, setEntries] = useState<GameAILogEntry[]>([]);

  useEffect(() => {
    return gameAILogger.subscribe((allEntries) => {
      const currentSessionId = getSessionId?.() ?? staticSessionId ?? "";
      const filtered = currentSessionId ? allEntries.filter((e) => e.sessionId === currentSessionId) : [];
      setEntries(filtered);
    });
  }, [getSessionId, staticSessionId]);

  const handleClear = () => {
    const currentSessionId = getSessionId?.() ?? staticSessionId;
    if (currentSessionId) {
      gameAILogger.clearSession(currentSessionId);
    }
  };

  const handleCopy = () => {
    const json = JSON.stringify(entries, null, 2);
    navigator.clipboard.writeText(json).catch(() => {});
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: PALETTE.bg }}>
      <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
        <div className="flex items-center gap-2">
          <Gamepad2 size={12} style={{ color: PALETTE.out }} />
          <span className="text-[10px] font-medium tracking-widest uppercase" style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.out }}>
            WS / AI Log
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all hover:brightness-110 disabled:opacity-30"
            disabled={entries.length === 0}
            style={{
              fontFamily: "'Press Start 2P', monospace",
              backgroundColor: "transparent",
              border: `1px solid ${PALETTE.border}`,
              color: PALETTE.muted,
              cursor: entries.length === 0 ? "not-allowed" : "pointer",
            }}
            title="Copy all as JSON"
          >
            <Copy size={10} />
            COPIAR
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all hover:brightness-110"
            style={{
              fontFamily: "'Press Start 2P', monospace",
              backgroundColor: "transparent",
              border: `1px solid ${PALETTE.border}`,
              color: PALETTE.muted,
              cursor: "pointer",
            }}
            title="Clear log"
          >
            <Trash2 size={10} />
            LIMPIAR
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: "thin", scrollbarColor: `${PALETTE.border} transparent` }}>
        {entries.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span className="text-[8px]" style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.muted }}>
              Sin mensajes
            </span>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span
                className="font-bold shrink-0"
                style={{
                  fontFamily: "monospace",
                  fontSize: 9,
                  color: entry.direction === "→" ? PALETTE.out : PALETTE.in,
                }}
              >
                {entry.direction}
              </span>
              <span
                className="flex-1 truncate text-[9px]"
                style={{
                  fontFamily: "monospace",
                  fontSize: 9,
                  color: entry.direction === "→" ? PALETTE.out : PALETTE.in,
                }}
              >
                {entry.event}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 7, color: PALETTE.muted }}>
                {formatTime(entry.timestamp)}
              </span>
            </div>
            <pre
              className="whitespace-pre-wrap break-all rounded p-1 ml-4"
              style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 8,
                lineHeight: 1.4,
                color: entry.direction === "→" ? "rgba(34, 211, 238, 0.7)" : "rgba(167, 139, 250, 0.7)",
                backgroundColor: entry.direction === "→" ? "rgba(34, 211, 238, 0.05)" : "rgba(167, 139, 250, 0.05)",
                border: `1px solid ${entry.direction === "→" ? "rgba(34, 211, 238, 0.1)" : "rgba(167, 139, 250, 0.1)"}`,
                maxHeight: 160,
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
