import { useState, useEffect } from "react";
import { Gamepad2, Trash2, Copy } from "lucide-react";
import { gameSessionStore } from "../../games/core/game-session-store";
import type { GameTurnData } from "../../games/core/game-session-types";

interface Props {
  getSessionId?: () => string;
  sessionId?: string;
}

const PALETTE = {
  out: "#22d3ee",
  in: "#a78bfa",
  muted: "#64748b",
  bg: "rgba(15, 23, 42, 0.9)",
  border: "rgba(124, 58, 237, 0.3)",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function GameDebugPanel({ getSessionId, sessionId: staticSessionId }: Props) {
  const [turns, setTurns] = useState<GameTurnData[]>([]);

  useEffect(() => {
    const update = () => {
      const currentSessionId = getSessionId?.() ?? staticSessionId ?? "";
      setTurns(currentSessionId ? gameSessionStore.getTurns(currentSessionId) : []);
    };
    update();
    return gameSessionStore.subscribe(update);
  }, [getSessionId, staticSessionId]);

  const handleClear = () => {
    const currentSessionId = getSessionId?.() ?? staticSessionId;
    if (currentSessionId) {
      gameSessionStore.clearSession(currentSessionId);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(turns, null, 2)).catch(() => {});
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: PALETTE.bg }}>
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${PALETTE.border}` }}
      >
        <div className="flex items-center gap-2">
          <Gamepad2 size={12} style={{ color: PALETTE.out }} />
          <span
            className="text-[10px] font-medium tracking-widest uppercase"
            style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.out }}
          >
            WS / AI Log
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={turns.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all hover:brightness-110 disabled:opacity-30"
            style={{
              fontFamily: "'Press Start 2P', monospace",
              backgroundColor: "transparent",
              border: `1px solid ${PALETTE.border}`,
              color: PALETTE.muted,
              cursor: turns.length === 0 ? "not-allowed" : "pointer",
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

      <div
        className="flex-1 overflow-y-auto p-2 space-y-2"
        style={{ scrollbarWidth: "thin", scrollbarColor: `${PALETTE.border} transparent` }}
      >
        {turns.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span
              className="text-[8px]"
              style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.muted }}
            >
              Sin mensajes
            </span>
          </div>
        )}
        {turns.map((turn) => {
          const isPlayer = turn.actor === "player";
          return (
            <div key={turn.turnId} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="font-bold shrink-0"
                  style={{
                    fontFamily: "monospace",
                    fontSize: 9,
                    color: isPlayer ? PALETTE.out : PALETTE.in,
                  }}
                >
                  {isPlayer ? "🧑" : "🤖"}
                </span>
                <span
                  className="flex-1 truncate text-[9px]"
                  style={{
                    fontFamily: "monospace",
                    fontSize: 9,
                    color: isPlayer ? PALETTE.out : PALETTE.in,
                  }}
                >
                  Turno {turn.turnNumber} · {isPlayer ? "PLAYER" : "AI"} · {turn.action.type}
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 7, color: PALETTE.muted }}>
                  {formatTime(turn.timestamp)}
                </span>
              </div>
              <pre
                className="whitespace-pre-wrap break-all rounded p-1 ml-4"
                style={{
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontSize: 8,
                  lineHeight: 1.4,
                  color: isPlayer ? "rgba(34, 211, 238, 0.7)" : "rgba(167, 139, 250, 0.7)",
                  backgroundColor: isPlayer
                    ? "rgba(34, 211, 238, 0.05)"
                    : "rgba(167, 139, 250, 0.05)",
                  border: `1px solid ${isPlayer ? "rgba(34, 211, 238, 0.1)" : "rgba(167, 139, 250, 0.1)"}`,
                  maxHeight: 160,
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                {JSON.stringify(
                  {
                    action: turn.action,
                    stateAfter: turn.stateAfter,
                    reasoning: turn.reasoning?.text,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
