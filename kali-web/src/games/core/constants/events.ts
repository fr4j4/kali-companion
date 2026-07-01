export const GameEvents = {
  START: "game:start",
  STATE: "game:state",
  ACTION: "game:action",
  AI_MOVE: "game:ai_move",
  HELP: "game:help",
  END: "game:end",
} as const;

export type GameEventType = (typeof GameEvents)[keyof typeof GameEvents];
