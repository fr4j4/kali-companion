export const PlayerType = {
  HUMAN: "human",
  AI: "ai",
  CONTENT: "content",
} as const;

export type PlayerTypeValue = (typeof PlayerType)[keyof typeof PlayerType];

export const SlotId = {
  PLAYER: "player",
  OPPONENT: "opponent",
  TEAMMATE: "teammate",
  PLAYER2: "player2",
} as const;

export type SlotIdValue = (typeof SlotId)[keyof typeof SlotId];
