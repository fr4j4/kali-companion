import type { GameTypeValue } from "./constants/game-types";
import type { GameConfig } from "./types/game-config";
import { BaseGame } from "./base-game";

type GameConstructor = new (config: GameConfig) => BaseGame;

export class GameRegistry {
  private static _games = new Map<GameTypeValue, GameConstructor>();

  static register(type: GameTypeValue, ctor: GameConstructor): void {
    if (GameRegistry._games.has(type)) {
      throw new Error(`Game type "${type}" is already registered`);
    }
    GameRegistry._games.set(type, ctor);
  }

  static create(type: GameTypeValue, config: GameConfig): BaseGame {
    const Ctor = GameRegistry._games.get(type);
    if (!Ctor) {
      throw new Error(`Unknown game type: "${type}"`);
    }
    return new Ctor(config);
  }

  static isRegistered(type: GameTypeValue): boolean {
    return GameRegistry._games.has(type);
  }

  static listTypes(): GameTypeValue[] {
    return [...GameRegistry._games.keys()];
  }
}
