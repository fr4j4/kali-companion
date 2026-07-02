import { useState, useEffect, useRef } from "react";
import { Brain, Trash2 } from "lucide-react";
import type { WSClient } from "../../lib/wsClient";

interface ReasoningEntry {
  id: string;
  timestamp: number;
  text: string;
}

interface Props {
  sessionId: string;
  wsClient: WSClient | null;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function GameReasoningPanel({ sessionId, wsClient }: Props) {
  const [entries, setEntries] = useState<ReasoningEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entryIdRef = useRef(0);

  useEffect(() => {
    if (!wsClient || !sessionId) return;

    const prefix = `game_move_reasoning:${sessionId}`;
    const unsub = wsClient.onDynamic(prefix, (payload) => {
      const ev = payload as { chunk?: string; done?: boolean };
      if (ev.chunk) {
        entryIdRef.current += 1;
        const entry: ReasoningEntry = {
          id: `r-${entryIdRef.current}`,
          timestamp: Date.now(),
          text: ev.chunk,
        };
        setEntries((prev) => [...prev, entry]);
      }
    });

    return unsub;
  }, [wsClient, sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleClear = () => {
    setEntries([]);
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "rgba(15, 23, 42, 0.9)" }}>
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: "1px solid rgba(56, 189, 248, 0.2)" }}
      >
        <div className="flex items-center gap-2">
          <Brain size={12} style={{ color: "#22d3ee" }} />
          <span
            className="text-[10px] font-medium tracking-widest uppercase"
            style={{ fontFamily: "'Press Start 2P', monospace", color: "#22d3ee" }}
          >
            Kali Reasoning
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all hover:brightness-110 disabled:opacity-30"
            disabled={entries.length === 0}
            style={{
              fontFamily: "'Press Start 2P', monospace",
              backgroundColor: "transparent",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              color: "#64748b",
              cursor: entries.length === 0 ? "not-allowed" : "pointer",
            }}
            title="Clear reasoning log"
          >
            <Trash2 size={10} />
            LIMPIAR
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(56, 189, 248, 0.2) transparent" }}
      >
        {entries.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span
              className="text-[8px] text-center px-4"
              style={{ fontFamily: "'Press Start 2P', monospace", color: "#64748b", lineHeight: 1.6 }}
            >
              Esperando razonamiento de Kali...
            </span>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span style={{ fontFamily: "monospace", fontSize: 9, color: "#22d3ee" }}>🧠</span>
              <span style={{ fontFamily: "monospace", fontSize: 9, color: "#22d3ee" }}>
                reasoning
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 7, color: "#64748b", marginLeft: "auto" }}>
                {formatTime(entry.timestamp)}
              </span>
            </div>
            <div
              className="whitespace-pre-wrap break-all rounded p-1 ml-4"
              style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 9,
                lineHeight: 1.4,
                color: "rgba(148, 163, 184, 0.9)",
                backgroundColor: "rgba(56, 189, 248, 0.04)",
                border: "1px solid rgba(56, 189, 248, 0.1)",
              }}
            >
              {entry.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
