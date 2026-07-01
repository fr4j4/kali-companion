export const GameType = {
  SNAKE: "snake",
  TIC_TAC_TOE: "tictactoe",
  TWENTY_FORTY_EIGHT: "2048",
  MEMORY: "memory",
  MINESWEEPER: "minesweeper",
  BREAKOUT: "breakout",
  TRIVIA: "trivia",
  WORDLE: "wordle",
  CHESS: "chess",
  CONNECT4: "connect4",
  RPS: "rps",
  STORY_BUILDER: "story_builder",
  MATH_CHALLENGE: "math_challenge",
  CODE_GUESS: "code_guess",
  TRUE_FALSE: "true_false",
  PREGUNTADOS: "preguntados",
  FILL_BLANK: "fill_blank",
  WORD_HINT: "word_hint",
  PUZZLE_SLIDE: "puzzle_slide",
} as const;

export type GameTypeValue = (typeof GameType)[keyof typeof GameType];
