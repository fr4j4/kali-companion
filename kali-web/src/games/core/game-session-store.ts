import type { WSClient } from "../../lib/wsClient";
import type {
  GameSessionData,
  GameTurnData,
  GameEventData,
  GameLogEntry,
} from "./game-session-types";
import type { GameAction } from "./types/game-action";
import { GAME_SESSION_WS_EVENT } from "./game-session-constants";

type Subscriber = () => void;

export const GAME_SESSION_RETENTION = {
  maxSessions: 20,
  maxTurnsPerSession: 100,
  maxEventsPerSession: 200,
  maxLogEntriesPerSession: 50,
  maxReasoningChars: 12_000,
} as const;

class GameSessionStore {
  private sessions = new Map<string, GameSessionData>();
  private subscribers = new Set<Subscriber>();
  private wsClient: WSClient | null = null;

  /** Inyectar el WSClient del juego (gameWSClient singleton). */
  setWSClient(client: WSClient | null): void {
    this.wsClient = client;
  }

  startSession(
    sessionId: string,
    gameId: string,
    paradigm: "turn-based" | "realtime",
  ): void {
    const session: GameSessionData = {
      sessionId,
      gameId,
      paradigm,
      status: "active",
      startedAt: Date.now(),
      logEntries: [],
      ...(paradigm === "turn-based" ? { turns: [] } : { events: [] }),
    };
    this.sessions.set(sessionId, session);
    this.enforceSessionRetention();
    this.emit();
    this.send(GAME_SESSION_WS_EVENT.START, {
      sessionId,
      gameId,
      paradigm,
    });
  }

  addTurn(sessionId: string, turn: GameTurnData): void {
    const s = this.sessions.get(sessionId);
    if (s?.turns) {
      s.turns.push(turn);
      this.send(GAME_SESSION_WS_EVENT.TURN, {
        sessionId,
        turnData: turn,
      });
      this.enforceSessionRetention(s);
      this.emit();
    }
  }

  /** Actualiza el reasoning de un turno AI en progreso (streaming de chunks). */
  updateTurnReasoning(sessionId: string, turnNumber: number, chunk: string): void {
    const s = this.sessions.get(sessionId);
    if (!s?.turns) return;
    const turn = s.turns.find((t) => t.turnNumber === turnNumber);
    if (turn?.reasoning) {
      turn.reasoning.text = this.truncateReasoning(turn.reasoning.text + chunk);
      this.emit();
    }
  }

  /** Marca el reasoning de un turno como completo. */
  finalizeTurnReasoning(
    sessionId: string,
    turnNumber: number,
    finalText: string,
  ): void {
    const s = this.sessions.get(sessionId);
    if (!s?.turns) return;
    const turn = s.turns.find((t) => t.turnNumber === turnNumber);
    if (turn?.reasoning) {
      turn.reasoning.text = this.truncateReasoning(finalText);
      turn.reasoning.done = true;
      this.emit();
    }
  }

  /** Completa la acción y el estado resultante de un turno AI en placeholder. */
  completeAITurn(
    sessionId: string,
    turnNumber: number,
    action: GameAction,
    stateAfter: unknown,
  ): void {
    const s = this.sessions.get(sessionId);
    if (!s?.turns) return;
    const turn = s.turns.find((t) => t.turnNumber === turnNumber);
    if (!turn) return;
    turn.action = action;
    turn.stateAfter = stateAfter;
    this.emit();
  }

  addEvent(sessionId: string, event: GameEventData): void {
    const s = this.sessions.get(sessionId);
    if (s?.events) {
      s.events.push(event);
      this.send(GAME_SESSION_WS_EVENT.EVENT, {
        sessionId,
        eventData: event,
      });
      this.enforceSessionRetention(s);
      this.emit();
    }
  }

  addLogEntry(sessionId: string, entry: GameLogEntry): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      if (!s.logEntries) s.logEntries = [];
      s.logEntries.push(entry);
      if (s.logEntries.length > GAME_SESSION_RETENTION.maxLogEntriesPerSession) {
        s.logEntries.splice(0, s.logEntries.length - GAME_SESSION_RETENTION.maxLogEntriesPerSession);
      }
      this.emit();
    }
  }

  getLogEntries(sessionId: string): GameLogEntry[] {
    return this.sessions.get(sessionId)?.logEntries ?? [];
  }

  clearLogEntries(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.logEntries = [];
      this.emit();
    }
  }

  endSession(
    sessionId: string,
    status: "won" | "lost" | "draw" | "abandoned",
  ): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.status = status;
    s.endedAt = Date.now();
    this.enforceSessionRetention(s);
    this.enforceSessionRetention();
    this.emit();
    // Enviar sesión completa al backend para persistencia
    this.send(GAME_SESSION_WS_EVENT.END, {
      sessionId: s.sessionId,
      gameId: s.gameId,
      paradigm: s.paradigm,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      turns: s.turns ?? [],
      events: s.events ?? [],
    });
  }

  getSession(sessionId: string): GameSessionData | undefined {
    return this.sessions.get(sessionId);
  }

  getTurns(sessionId: string): GameTurnData[] {
    return this.sessions.get(sessionId)?.turns ?? [];
  }

  getAITurns(sessionId: string): GameTurnData[] {
    return this.getTurns(sessionId).filter((t) => t.actor === "ai");
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.emit();
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private send(event: string, payload: Record<string, unknown>): void {
    this.wsClient?.send({ event, ...payload });
  }

  private emit(): void {
    this.subscribers.forEach((fn) => fn());
  }

  private enforceSessionRetention(session?: GameSessionData): void {
    if (session?.turns && session.turns.length > GAME_SESSION_RETENTION.maxTurnsPerSession) {
      session.turns.splice(0, session.turns.length - GAME_SESSION_RETENTION.maxTurnsPerSession);
    }
    if (session?.events && session.events.length > GAME_SESSION_RETENTION.maxEventsPerSession) {
      session.events.splice(0, session.events.length - GAME_SESSION_RETENTION.maxEventsPerSession);
    }
    if (session?.logEntries && session.logEntries.length > GAME_SESSION_RETENTION.maxLogEntriesPerSession) {
      session.logEntries.splice(0, session.logEntries.length - GAME_SESSION_RETENTION.maxLogEntriesPerSession);
    }
    if (session?.turns) {
      for (const turn of session.turns) {
        if (turn.reasoning) {
          turn.reasoning.text = this.truncateReasoning(turn.reasoning.text);
        }
      }
    }
    if (!session && this.sessions.size > GAME_SESSION_RETENTION.maxSessions) {
      const overflow = this.sessions.size - GAME_SESSION_RETENTION.maxSessions;
      const candidates = [...this.sessions.values()]
        .sort((a, b) => {
          const aEnded = a.endedAt ?? Number.MAX_SAFE_INTEGER;
          const bEnded = b.endedAt ?? Number.MAX_SAFE_INTEGER;
          if (aEnded !== bEnded) return aEnded - bEnded;
          return a.startedAt - b.startedAt;
        })
        .slice(0, overflow);
      for (const candidate of candidates) {
        this.sessions.delete(candidate.sessionId);
      }
    }
  }

  private truncateReasoning(text: string): string {
    if (text.length <= GAME_SESSION_RETENTION.maxReasoningChars) return text;
    return text.slice(text.length - GAME_SESSION_RETENTION.maxReasoningChars);
  }
}

export const gameSessionStore = new GameSessionStore();

export { GameSessionStore };
