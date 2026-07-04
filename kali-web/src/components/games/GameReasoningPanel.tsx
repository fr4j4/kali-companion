import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Trash2 } from "lucide-react";
import { gameSessionStore } from "../../games/core/game-session-store";
import type { GameTurnData } from "../../games/core/game-session-types";

interface Props {
  getSessionId: () => string;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function GameReasoningPanel({ getSessionId }: Props) {
  const { t } = useTranslation();
  const [aiTurns, setAITurns] = useState<GameTurnData[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const sid = getSessionId();
      setAITurns(sid ? gameSessionStore.getAITurns(sid) : []);
    };
    update();
    return gameSessionStore.subscribe(update);
  }, [getSessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [aiTurns]);

  const handleClear = () => {
    const sid = getSessionId();
    if (sid) {
      gameSessionStore.clearSession(sid);
    }
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
            {t("game_reasoning.title")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            disabled={aiTurns.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all hover:brightness-110 disabled:opacity-30"
            style={{
              fontFamily: "'Press Start 2P', monospace",
              backgroundColor: "transparent",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              color: "#64748b",
              cursor: aiTurns.length === 0 ? "not-allowed" : "pointer",
            }}
            title={t("game_reasoning.clear_title")}
          >
            <Trash2 size={10} />
            {t("game_reasoning.clear")}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-2"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(56, 189, 248, 0.2) transparent" }}
      >
        {aiTurns.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span
              className="text-[8px] text-center px-4"
              style={{ fontFamily: "'Press Start 2P', monospace", color: "#64748b", lineHeight: 1.6 }}
            >
              {t("game_reasoning.empty")}
            </span>
          </div>
        )}
        {aiTurns.map((turn) => (
          <div key={turn.turnId} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span style={{ fontFamily: "monospace", fontSize: 9, color: "#22d3ee" }}>
                {"\u{1F9E0}"} {t("game_reasoning.turn", { number: turn.turnNumber })}
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 7,
                  color: "#64748b",
                  marginLeft: "auto",
                }}
              >
                {formatTime(turn.timestamp)}
              </span>
            </div>
            <div
              className="whitespace-pre-wrap break-all rounded p-2 ml-4"
              style={{
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                fontSize: 9,
                lineHeight: 1.5,
                color: "rgba(148, 163, 184, 0.9)",
                backgroundColor: "rgba(56, 189, 248, 0.04)",
                border: "1px solid rgba(56, 189, 248, 0.1)",
              }}
            >
              {turn.reasoning?.text}
              {turn.reasoning && !turn.reasoning.done && (
                <span className="inline-block ml-0.5 animate-pulse" style={{ color: "#22d3ee" }}>
                  \u258C
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
