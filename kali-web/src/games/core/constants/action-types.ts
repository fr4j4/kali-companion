export const GameCommand = {
  START: "start",
  RESTART: "restart",
  PAUSE: "pause",
  RESUME: "resume",
  GIVE_UP: "give_up",
  PLAY_AGAIN: "play_again",
  REQUEST_HINT: "request_hint",
} as const;

export type GameCommandValue = (typeof GameCommand)[keyof typeof GameCommand];

export const ActionType = {
  SELECT: "select",
  MOVE: "move",
  TEXT: "text",
  COMMAND: "command",
  CUSTOM: "custom",
} as const;

export type ActionTypeValue = (typeof ActionType)[keyof typeof ActionType];
