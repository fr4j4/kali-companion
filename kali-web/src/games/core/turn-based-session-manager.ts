import type { BaseGame } from "./base-game";
import type { MoveProvider } from "../ai/ai-slot-filler";
import type { SlotIdValue } from "./constants/player-types";
import type { KaliStatusValue } from "./constants/game-ai";
import type { GameAction } from "./types/game-action";
import type { GameSessionManager, GameSessionManagerCallbacks } from "./game-session-manager";
import { PlayerType, SlotId } from "./constants/player-types";
import { ActionType, GameCommand } from "./constants/action-types";
import type { GameCommandValue } from "./constants/action-types";
import type { GameConfig } from "./types/game-config";
import { KaliStatus, KaliErrorCode, KALI_MAX_RETRIES } from "./constants/game-ai";
import { KaliError } from "../ai/kali-error";
import { gameSessionStore } from "./game-session-store";
import { GAME_ACTOR, PLACEHOLDER_AI_ACTION } from "./game-session-constants";

/**
 * TurnBasedSessionManager — transversal turn-loop orchestrator.
 *
 * Owns the player → AI turn cycle for any turn-based game that exposes:
 *  - `game.slots` with PlayerType.HUMAN / PlayerType.AI
 *  - `game.getState().data.currentSlot` to know whose turn is next
 *  - `game.handleAction(action, slotId)` to apply a move
 */
export class TurnBasedSessionManager implements GameSessionManager {
  private readonly _game: BaseGame;
  private readonly _callbacks: GameSessionManagerCallbacks;
  private readonly _providers: Map<SlotIdValue, MoveProvider>;
  private readonly _subscribers = new Set<() => void>();

  private _turnNumber = 0;
  private _retryCount = 0;
  private _kaliStatus: KaliStatusValue = KaliStatus.IDLE;
  private _kaliError: KaliError | null = null;
  private _cancelled = false;
  private _activeProvider: MoveProvider | null = null;

  constructor(
    game: BaseGame,
    providers: ReadonlyMap<SlotIdValue, MoveProvider>,
    callbacks: GameSessionManagerCallbacks,
  ) {
    this._game = game;
    this._callbacks = callbacks;
    this._providers = new Map(providers);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get kaliStatus(): KaliStatusValue {
    return this._kaliStatus;
  }

  get kaliError(): KaliError | null {
    return this._kaliError;
  }

  get retryCount(): number {
    return this._retryCount;
  }

  // ── Common lifecycle ───────────────────────────────────────────────────────

  start(): void {
    void this._maybeTriggerAITurn();
  }

  restart(config?: GameConfig): void {
    this._cancelled = false;
    this._activeProvider?.abort();
    this._activeProvider = null;
    this._retryCount = 0;
    this._kaliError = null;
    this._game.restart(config);
    this._stateChanged();
    void this._maybeTriggerAITurn();
  }

  destroy(): void {
    this._cancelled = true;
    this._activeProvider?.abort();
    this._activeProvider = null;
  }

  pause(): void {
    this._game.pause();
    this._stateChanged();
  }

  resume(): void {
    this._game.resume();
    this._stateChanged();
  }

  giveUp(): void {
    this.sendCommand(GameCommand.GIVE_UP);
  }

  sendCommand(command: GameCommandValue): void {
    const humanSlot = this._findHumanSlot() ?? SlotId.PLAYER;
    this._game.handleAction({ type: ActionType.COMMAND, data: command }, humanSlot);
    this._stateChanged();
    void this._maybeTriggerAITurn();
  }

  // ── Turn-based API ─────────────────────────────────────────────────────────

  submitPlayerAction(action: GameAction): void {
    const humanSlot = this._findHumanSlot();
    if (!humanSlot) return;

    this._game.handleAction(action, humanSlot);
    this._turnNumber += 1;

    gameSessionStore.addTurn(this._game.sessionId, {
      turnId: crypto.randomUUID(),
      turnNumber: this._turnNumber,
      slotId: humanSlot,
      actor: GAME_ACTOR.PLAYER,
      action,
      stateAfter: this._clone(this._game.getState().data),
      timestamp: Date.now(),
    });

    this._stateChanged();
    void this._maybeTriggerAITurn();
  }

  retryAI(): void {
    if (this._retryCount >= KALI_MAX_RETRIES) return;
    this._retryCount += 1;
    this._setKaliStatus(KaliStatus.THINKING);
    void this._triggerAITurn();
  }

  fallbackToCPU(provider: MoveProvider): void {
    const aiSlot = this._findAISlot();
    if (aiSlot) {
      this._providers.set(aiSlot, provider);
    }
    this._retryCount = 0;
  }

  // ── Subscription ───────────────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this._subscribers.add(fn);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _findHumanSlot(): SlotIdValue | null {
    return this._game.slots.find((s) => s.type === PlayerType.HUMAN)?.id ?? null;
  }

  private _findAISlot(): SlotIdValue | null {
    return (
      this._game.slots.find(
        (s) => s.type === PlayerType.AI && this._providers.has(s.id),
      )?.id ?? null
    );
  }

  private _getCurrentSlot(): string | null {
    const data = this._game.getState().data as { currentSlot?: string } | null;
    return data?.currentSlot ?? null;
  }

  private async _maybeTriggerAITurn(): Promise<void> {
    if (this._cancelled) return;
    const currentSlot = this._getCurrentSlot();
    const aiSlot = this._findAISlot();
    if (currentSlot && aiSlot && currentSlot === aiSlot) {
      await this._triggerAITurn();
    }
  }

  private async _triggerAITurn(): Promise<void> {
    if (this._cancelled) return;

    const aiSlot = this._findAISlot();
    if (!aiSlot) return;

    this._setKaliStatus(KaliStatus.THINKING);
    this._kaliError = null;

    this._turnNumber += 1;
    const turnNumber = this._turnNumber;

    // FIX DEL BUG: crear el turno placeholder AI ANTES de llamar a decide().
    // Así los chunks de reasoning tienen un turno donde acumularse.
    gameSessionStore.addTurn(this._game.sessionId, {
      turnId: crypto.randomUUID(),
      turnNumber,
      slotId: aiSlot,
      actor: GAME_ACTOR.AI,
      action: PLACEHOLDER_AI_ACTION as GameAction,
      stateAfter: this._clone(this._game.getState().data),
      timestamp: Date.now(),
      reasoning: { text: "", done: false },
    });

    const provider = this._providers.get(aiSlot);
    if (!provider) {
      this._setError(
        new KaliError(
          KaliErrorCode.WS_ERROR,
          `No AI provider registered for slot ${aiSlot}`,
        ),
      );
      return;
    }

    this._activeProvider = provider;

    try {
      const collectedReasoning: string[] = [];
      const action = await provider.decide(
        this._game.getState(),
        turnNumber,
        (chunk: string) => {
          collectedReasoning.push(chunk);
          gameSessionStore.updateTurnReasoning(this._game.sessionId, turnNumber, chunk);
        },
      );

      if (this._cancelled) return;

      // Providers may stream via onReasoning (mocks/future) or return reasoning in the action (CPU/AISlot).
      // We finalize here so every provider's reasoning ends up in the store.
      const finalReasoning = action.reasoning ?? collectedReasoning.join("");
      gameSessionStore.finalizeTurnReasoning(
        this._game.sessionId,
        turnNumber,
        finalReasoning,
      );

      this._game.handleAction(action, aiSlot);

      gameSessionStore.completeAITurn(
        this._game.sessionId,
        turnNumber,
        action,
        this._clone(this._game.getState().data),
      );

      this._retryCount = 0;
      this._activeProvider = null;
      this._setKaliStatus(KaliStatus.IDLE);
      this._stateChanged();

      // Si el juego sigue con el mismo slot AI (raro pero posible), continuar.
      await this._maybeTriggerAITurn();
    } catch (err) {
      this._activeProvider = null;
      if (this._cancelled) return;
      this._setError(this._toKaliError(err));
    }
  }

  private _setKaliStatus(status: KaliStatusValue): void {
    this._kaliStatus = status;
    this._callbacks.onAIStatusChange(status, this._kaliError ?? undefined);
    this._notify();
  }

  private _setError(error: KaliError): void {
    this._kaliError = error;
    this._kaliStatus = KaliStatus.ERROR;
    this._callbacks.onAIStatusChange(KaliStatus.ERROR, error);
    this._notify();
  }

  private _stateChanged(): void {
    this._callbacks.onStateChange();
    this._notify();
  }

  private _notify(): void {
    this._subscribers.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore subscriber errors
      }
    });
  }

  private _toKaliError(err: unknown): KaliError {
    if (err instanceof KaliError) {
      return err;
    }
    return new KaliError(
      KaliErrorCode.WS_ERROR,
      err instanceof Error ? err.message : String(err),
    );
  }

  private _clone(data: unknown): unknown {
    if (data === null || typeof data !== "object") return data;
    if (typeof structuredClone === "function") return structuredClone(data);
    try {
      return JSON.parse(JSON.stringify(data));
    } catch {
      return data;
    }
  }
}
