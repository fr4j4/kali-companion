import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useGameWS } from "../../lib/gameWSClient";
import { GAME_SESSION_WS_EVENT } from "../../games/core/game-session-constants";
import type { GameSessionData, GameTurnData } from "../../games/core/game-session-types";
import type { TicTacToeData } from "../../games/tic-tac-toe/tic-tac-toe-game";

interface Props {
  sessionId: string;
}

const PALETTE = {
  x: "#22d3ee",
  o: "#d946ef",
  empty: "rgba(30, 58, 138, 0.4)",
  border: "rgba(56, 189, 248, 0.3)",
};

function renderBoard(board: (string | null)[][]) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(3, 32px)",
        gridTemplateRows: "repeat(3, 32px)",
        gap: "4px",
      }}
    >
      {board.flatMap((row, r) =>
        row.map((cell, c) => (
          <div
            key={`${r}-${c}`}
            className="flex items-center justify-center rounded text-sm font-bold"
            style={{
              width: 32,
              height: 32,
              backgroundColor: PALETTE.empty,
              color: cell === "X" ? PALETTE.x : PALETTE.o,
              border: `1px solid ${PALETTE.border}`,
            }}
          >
            {cell || ""}
          </div>
        )),
      )}
    </div>
  );
}

export function SavedGameReplay({ sessionId }: Props) {
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith("es");
  const wsClient = useGameWS();
  const [session, setSession] = useState<GameSessionData | null>(null);

  useEffect(() => {
    if (!wsClient) return;
    wsClient.send({
      event: GAME_SESSION_WS_EVENT.LOAD,
      sessionId,
    });

    const handler = (payload: unknown) => {
      const ev = payload as { session?: GameSessionData | null };
      if (ev.session) {
        setSession(ev.session);
      }
    };

    const unsub = wsClient.on(GAME_SESSION_WS_EVENT.LOADED, handler);
    return unsub;
  }, [wsClient, sessionId]);

  if (!session) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center text-muted">
        {isEs ? "Cargando partida..." : "Loading game..."}
      </div>
    );
  }

  const turns = session.turns ?? [];

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 gap-4 overflow-y-auto">
      <h2 className="text-lg font-semibold text-fg">
        {isEs ? "Replay de la partida" : "Game Replay"}
      </h2>
      <p className="text-xs text-muted">
        {new Date(session.startedAt).toLocaleString()} · {turns.length} turnos
      </p>

      <div className="flex flex-col gap-4">
        {turns.map((turn: GameTurnData) => {
          const state = turn.stateAfter as TicTacToeData | undefined;
          const isPlayer = turn.actor === "player";

          return (
            <div
              key={turn.turnId}
              className="flex flex-col gap-2 p-3 rounded-lg border border-border/50 bg-surface/30"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <span>{isPlayer ? "🧑" : "🤖"}</span>
                <span>
                  Turno {turn.turnNumber} · {isPlayer ? "Jugador" : "Kali"}
                </span>
              </div>

              <div className="flex items-start gap-4">
                {state?.board && renderBoard(state.board)}
                <div className="flex flex-col gap-1 text-xs text-muted">
                  <span>Acción: {JSON.stringify(turn.action)}</span>
                  <span>
                    {new Date(turn.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {turn.reasoning && (
                <div className="text-xs text-muted/80 bg-surface/50 rounded p-2"
                >
                  <span className="font-semibold text-accent">Razonamiento:</span> {turn.reasoning.text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
