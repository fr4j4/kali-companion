export const GameStatus = {
  WAITING: "waiting",
  PLAYING: "playing",
  PAUSED: "paused",
  WON: "won",
  LOST: "lost",
  DRAW: "draw",
} as const;

export type GameStatusValue = (typeof GameStatus)[keyof typeof GameStatus];
