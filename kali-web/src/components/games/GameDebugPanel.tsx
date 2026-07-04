import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Gamepad2,
  Trash2,
  Copy,
  User,
  Bot,
  Cpu,
  Send,
  Download,
  AlertTriangle,
} from "lucide-react";
import { gameSessionStore } from "../../games/core/game-session-store";
import type { GameLogEntry } from "../../games/core/game-session-types";

interface Props {
  getSessionId?: () => string;
  sessionId?: string;
}

const PALETTE = {
  bg: "rgba(15, 23, 42, 0.9)",
  border: "rgba(124, 58, 237, 0.3)",
  muted: "#64748b",
  timestamp: "rgba(100, 116, 139, 0.6)",
};

const LOG_COLORS = {
  player: { fg: "#22d3ee", bg: "rgba(34, 211, 238, 0.06)", border: "rgba(34, 211, 238, 0.15)" },
  ai: { fg: "#a78bfa", bg: "rgba(167, 139, 250, 0.06)", border: "rgba(167, 139, 250, 0.15)" },
  send: { fg: "#fbbf24", bg: "rgba(251, 191, 36, 0.06)", border: "rgba(251, 191, 36, 0.15)" },
  recv: { fg: "#4ade80", bg: "rgba(74, 222, 128, 0.06)", border: "rgba(74, 222, 128, 0.15)" },
  error: { fg: "#f87171", bg: "rgba(248, 113, 113, 0.06)", border: "rgba(248, 113, 113, 0.15)" },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncateError(msg: string, max = 60): string {
  return msg.length > max ? msg.slice(0, max) + "\u2026" : msg;
}

function getEntryStyle(entry: GameLogEntry) {
  switch (entry.kind) {
    case "turn":
      if (entry.label === "CPU FALLBACK") return { ...LOG_COLORS.ai, Icon: Cpu, badge: "CPU" };
      if (entry.details.actor === "player") return { ...LOG_COLORS.player, Icon: User, badge: "PLAYER" };
      return { ...LOG_COLORS.ai, Icon: Bot, badge: "AI" };
    case "ws_request": return { ...LOG_COLORS.send, Icon: Send, badge: "SEND" };
    case "ws_response": return { ...LOG_COLORS.recv, Icon: Download, badge: "RECV" };
    case "ws_error": return { ...LOG_COLORS.error, Icon: AlertTriangle, badge: "ERROR" };
  }
}

function getDetailText(entry: GameLogEntry): string {
  const d = entry.details;
  switch (entry.kind) {
    case "turn":
      if (entry.label === "CPU FALLBACK") return `CPU fallback \u00b7 ${d.difficulty ?? "medium"}`;
      if (d.actor === "player") {
        const move = d.action?.data as { row?: number; col?: number } | undefined;
        return move && typeof move.row === "number" && typeof move.col === "number"
          ? `placed at (${move.row}, ${move.col})`
          : "move";
      }
      return "thinking...";
    case "ws_request":
      return `${d.gameType ?? "?"} \u00b7 ${d.difficulty ?? "\u2014"} \u00b7 ${d.model ?? "default"}`;
    case "ws_response": {
      const m = d.move;
      return m ? `move (${m.row}, ${m.col})` : "response";
    }
    case "ws_error":
      return `\u2717 ${truncateError(d.errorMessage ?? "unknown error")}`;
  }
}

export function GameDebugPanel({ getSessionId, sessionId: staticSessionId }: Props) {
  const { t } = useTranslation();
  const [logEntries, setLogEntries] = useState<GameLogEntry[]>([]);

  useEffect(() => {
    const update = () => {
      const currentSessionId = getSessionId?.() ?? staticSessionId ?? "";
      const entries = currentSessionId ? gameSessionStore.getLogEntries(currentSessionId) : [];
      setLogEntries([...entries].sort((a, b) => a.timestamp - b.timestamp));
    };
    update();
    return gameSessionStore.subscribe(update);
  }, [getSessionId, staticSessionId]);

  const handleClear = () => {
    const currentSessionId = getSessionId?.() ?? staticSessionId;
    if (currentSessionId) {
      gameSessionStore.clearLogEntries(currentSessionId);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(logEntries, null, 2)).catch(() => {});
  };

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: PALETTE.bg }}>
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${PALETTE.border}` }}
      >
        <div className="flex items-center gap-2">
          <Gamepad2 size={12} style={{ color: LOG_COLORS.player.fg }} />
          <span
            className="text-[10px] font-medium tracking-widest uppercase"
            style={{ fontFamily: "'Press Start 2P', monospace", color: LOG_COLORS.player.fg }}
          >
            {t("game_debug.title")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={logEntries.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all hover:brightness-110 disabled:opacity-30"
            style={{
              fontFamily: "'Press Start 2P', monospace",
              backgroundColor: "transparent",
              border: `1px solid ${PALETTE.border}`,
              color: PALETTE.muted,
              cursor: logEntries.length === 0 ? "not-allowed" : "pointer",
            }}
            title={t("game_debug.copy_title")}
          >
            <Copy size={10} />
            {t("game_debug.copy")}
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
            title={t("game_debug.clear_title")}
          >
            <Trash2 size={10} />
            {t("game_debug.clear")}
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto p-2 space-y-1"
        style={{ scrollbarWidth: "thin", scrollbarColor: `${PALETTE.border} transparent` }}
      >
        {logEntries.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <span
              className="text-[8px]"
              style={{ fontFamily: "'Press Start 2P', monospace", color: PALETTE.muted }}
            >
              {t("game_debug.empty")}
            </span>
          </div>
        )}
        {logEntries.map((entry) => {
          const style = getEntryStyle(entry);
          if (!style) return null;
          const { Icon, fg, bg, border, badge } = style;
          const detailText = getDetailText(entry);
          const ts = formatTime(entry.timestamp);
          const dur = entry.details.durationMs != null ? ` \u00b7 ${entry.details.durationMs}ms` : "";

          return (
            <div
              key={entry.id}
              className="transition-all hover:brightness-110"
              style={{
                paddingLeft: "8px",
                paddingRight: "6px",
                paddingTop: "4px",
                paddingBottom: "4px",
                borderRadius: "2px",
                borderLeft: `2px solid ${fg}`,
                backgroundColor: bg,
              }}
            >
              <div className="flex items-center gap-1.5">
                <Icon size={10} style={{ color: fg, flexShrink: 0 }} />
                <span
                  className="inline-flex items-center px-1"
                  style={{
                    fontFamily: "'Press Start 2P', monospace",
                    fontSize: 7,
                    lineHeight: 1.2,
                    color: fg,
                    border: `1px solid ${border}`,
                    borderRadius: "2px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {badge}
                </span>
                <span
                  className="flex-1 truncate"
                  style={{
                    fontFamily: "'Press Start 2P', monospace",
                    fontSize: 8,
                    color: fg,
                  }}
                >
                  {entry.label}
                </span>
                <span
                  className="shrink-0"
                  style={{
                    fontFamily: "monospace",
                    fontSize: 7,
                    color: PALETTE.timestamp,
                  }}
                >
                  {ts}{dur}
                </span>
              </div>
              <div
                className="mt-0.5"
                style={{
                  marginLeft: "16px",
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  fontSize: 8,
                  color: PALETTE.muted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {detailText}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
