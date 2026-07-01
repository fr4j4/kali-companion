export interface GameAILogEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  direction: "→" | "←";
  event: string;
  payload: unknown;
}

type Subscriber = (entries: GameAILogEntry[]) => void;

export const gameAILogger = {
  _currentSessionId: "",
  _entries: new Map<string, GameAILogEntry[]>(),
  _subscribers: new Set<Subscriber>(),

  startSession(sessionId: string) {
    this._currentSessionId = sessionId;
    if (!this._entries.has(sessionId)) {
      this._entries.set(sessionId, []);
    }
  },

  log(direction: "→" | "←", event: string, payload: unknown) {
    let entries = this._entries.get(this._currentSessionId);
    if (!entries) {
      entries = [];
      this._entries.set(this._currentSessionId, entries);
    }
    const entry: GameAILogEntry = {
      id: crypto.randomUUID(),
      sessionId: this._currentSessionId,
      timestamp: Date.now(),
      direction,
      event,
      payload,
    };
    entries.push(entry);
    this._notify();
  },

  clear() {
    this._entries.delete(this._currentSessionId);
    this._notify();
  },

  clearSession(sessionId: string) {
    this._entries.delete(sessionId);
    this._notify();
  },

  getCurrentEntries(): GameAILogEntry[] {
    return this._entries.get(this._currentSessionId) ?? [];
  },

  getEntriesForSession(sessionId: string): GameAILogEntry[] {
    return this._entries.get(sessionId) ?? [];
  },

  getAllEntries(): GameAILogEntry[] {
    const all: GameAILogEntry[] = [];
    for (const entries of this._entries.values()) {
      all.push(...entries);
    }
    return all;
  },

  subscribe(fn: Subscriber): () => void {
    this._subscribers.add(fn);
    fn(this.getAllEntries());
    return () => {
      this._subscribers.delete(fn);
    };
  },

  _notify() {
    const entries = this.getAllEntries();
    this._subscribers.forEach((fn) => fn([...entries]));
  },
};
