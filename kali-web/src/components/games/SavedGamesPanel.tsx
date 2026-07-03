import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Eye } from "lucide-react";
import { useGameWS } from "../../lib/gameWSClient";
import { GAME_SESSION_WS_EVENT } from "../../games/core/game-session-constants";
import type { GameSessionMeta } from "../../games/core/game-session-types";
import type { WorkspaceAPI } from "../../workspace/types";

interface Props {
  api?: WorkspaceAPI;
}

const STATUS_LABEL: Record<string, string> = {
  won: "GANASTE",
  lost: "PERDISTE",
  draw: "EMPATE",
  abandoned: "ABANDONADA",
};

export function SavedGamesPanel({ api }: Props) {
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith("es");
  const wsClient = useGameWS();
  const [sessions, setSessions] = useState<GameSessionMeta[]>([]);

  const fetchList = useCallback(() => {
    if (!wsClient) return;
    wsClient.send({
      event: GAME_SESSION_WS_EVENT.LIST,
      gameId: "tictactoe",
    });
  }, [wsClient]);

  useEffect(() => {
    if (!wsClient) return;

    fetchList();

    const handler = (payload: unknown) => {
      const ev = payload as { sessions?: GameSessionMeta[] };
      if (Array.isArray(ev.sessions)) {
        setSessions(ev.sessions);
      }
    };

    const unsub = wsClient.on(GAME_SESSION_WS_EVENT.LIST, handler);
    return unsub;
  }, [wsClient, fetchList]);

  const handleDelete = (sessionId: string) => {
    wsClient?.send({
      event: GAME_SESSION_WS_EVENT.DELETE,
      sessionId,
    });
    // Optimistic update: remove from list immediately
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  };

  const handleView = (sessionId: string) => {
    if (!api) return;
    api.createWindow("game", {
      title: isEs ? "Replay de partida" : "Game replay",
      content: { mode: "saved-game-replay", sessionId },
      width: 520,
      height: 600,
      resizable: true,
      minW: 320,
      minH: 360,
    } as any);
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(isEs ? "es-ES" : "en-GB", {
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 gap-4 overflow-y-auto">
      <h2 className="text-lg font-semibold text-fg flex items-center gap-2">
        <span>{"\u{1F4CB}"}</span>
        {isEs ? "Partidas Guardadas" : "Saved Games"}
      </h2>

      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted">
          {isEs ? "No hay partidas guardadas aún." : "No saved games yet."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-surface/50"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-fg">
                  {STATUS_LABEL[s.status] ?? s.status.toUpperCase()}
                </span>
                <span className="text-xs text-muted">
                  {formatDate(s.startedAt)} · {s.turnCount} turnos
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleView(s.sessionId)}
                  className="p-2 rounded-md hover:bg-surface transition-colors"
                  title={isEs ? "Ver replay" : "View replay"}
                >
                  <Eye size={14} />
                </button>
                <button
                  onClick={() => handleDelete(s.sessionId)}
                  className="p-2 rounded-md hover:bg-danger/20 text-danger transition-colors"
                  title={isEs ? "Eliminar" : "Delete"}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
