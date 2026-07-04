import { GameType, type GameTypeValue } from "./core/constants/game-types";
import { SNAKE_I18N } from "./snake/snake-i18n";
import { TIC_TAC_TOE_I18N } from "./tic-tac-toe/tic-tac-toe-i18n";
import { TWENTY_FORTY_EIGHT_I18N } from "./twenty-forty-eight/twenty-forty-eight-i18n";

export interface GameEntry {
  id: GameTypeValue;
  name: string;
  icon: string;
  description: string;
  category: Category;
  players: string;
  getStrings?: (lang: string) => Record<string, string>;
}

export type Category = "single" | "versus" | "coop" | "trivia";

export const CATEGORIES: { id: Category; labelKey: string }[] = [
  { id: "single", labelKey: "game_catalog.category.single" },
  { id: "coop", labelKey: "game_catalog.category.coop" },
  { id: "versus", labelKey: "game_catalog.category.versus" },
  { id: "trivia", labelKey: "game_catalog.category.trivia" },
];

const enStrings = (m: Record<string, Record<string, string>>) => (lang: string) =>
  m[lang] ?? m.en;

export const GAME_CATALOG: GameEntry[] = [
  {
    id: GameType.SNAKE,
    name: "Snake",
    icon: "\u{1F40D}",
    description: "Classic snake game. Eat food, grow, don't crash into walls or yourself.",
    category: "single",
    players: "1P",
    getStrings: enStrings(SNAKE_I18N),
  },
  {
    id: GameType.TWENTY_FORTY_EIGHT,
    name: "2048",
    icon: "\u{1F9EE}",
    description: "Merge tiles to reach 2048. Slide and combine numbers.",
    category: "single",
    players: "1P",
    getStrings: enStrings(TWENTY_FORTY_EIGHT_I18N),
  },
  {
    id: GameType.MEMORY,
    name: "Memory",
    icon: "\u{1F52E}",
    description: "Flip cards and match pairs. Test your memory.",
    category: "single",
    players: "1P",
  },
  {
    id: GameType.MINESWEEPER,
    name: "Minesweeper",
    icon: "\u{1F4A3}",
    description: "Clear a minefield without detonating any mines.",
    category: "single",
    players: "1P",
  },
  {
    id: GameType.BREAKOUT,
    name: "Breakout",
    icon: "\u{1F3D0}",
    description: "Break all the bricks with a ball and paddle.",
    category: "single",
    players: "1P",
  },
  {
    id: GameType.PUZZLE_SLIDE,
    name: "Slide Puzzle",
    icon: "\u{1F9E9}",
    description: "Slide tiles to recreate the image.",
    category: "single",
    players: "1P",
  },
  {
    id: GameType.TIC_TAC_TOE,
    name: "Tic-Tac-Toe",
    icon: "\u{2B1C}",
    description: "Classic 3-in-a-row. Play against Kali or a friend.",
    category: "versus",
    players: "1-2P",
    getStrings: enStrings(TIC_TAC_TOE_I18N),
  },
  {
    id: GameType.CONNECT4,
    name: "Connect 4",
    icon: "\u{1F535}",
    description: "Drop discs and connect 4 in a row. Play against Kali.",
    category: "versus",
    players: "1-2P",
  },
  {
    id: GameType.CHESS,
    name: "Chess",
    icon: "\u265E",
    description: "Classic chess against Kali.",
    category: "versus",
    players: "1P",
  },
  {
    id: GameType.RPS,
    name: "Rock Paper Scissors",
    icon: "\u{1F44A}",
    description: "Rock paper scissors against Kali. Best of 3.",
    category: "versus",
    players: "1P",
  },
  {
    id: GameType.WORDLE,
    name: "Wordle",
    icon: "\u{1F520}",
    description: "Guess the 5-letter word in 6 tries.",
    category: "single",
    players: "1P",
  },
  {
    id: GameType.STORY_BUILDER,
    name: "Story Builder",
    icon: "\u{1F4D6}",
    description: "Build a story together with Kali, sentence by sentence.",
    category: "coop",
    players: "1P+Kali",
  },
  {
    id: GameType.MATH_CHALLENGE,
    name: "Math Challenge",
    icon: "\u{1F522}",
    description: "Solve math problems. Kali adapts the difficulty.",
    category: "coop",
    players: "1P+Kali",
  },
  {
    id: GameType.CODE_GUESS,
    name: "Code Guess",
    icon: "\u{1F4BB}",
    description: "Guess the secret code. Kali gives you hints.",
    category: "coop",
    players: "1P+Kali",
  },
  {
    id: GameType.TRIVIA,
    name: "Trivia",
    icon: "\u{1F3AF}",
    description: "General knowledge quiz with Kali as host.",
    category: "trivia",
    players: "1P+Kali",
  },
  {
    id: GameType.TRUE_FALSE,
    name: "True or False",
    icon: "\u2705",
    description: "Decide if statements are true or false. Kali scores you.",
    category: "trivia",
    players: "1P+Kali",
  },
  {
    id: GameType.PREGUNTADOS,
    name: "Preguntados",
    icon: "\u{1F30D}",
    description: "Category-based trivia game. Answer questions to earn points.",
    category: "trivia",
    players: "1P+Kali",
  },
  {
    id: GameType.FILL_BLANK,
    name: "Fill the Blank",
    icon: "\u{1F3B6}",
    description: "Complete the sentence with the right word. Kali helps.",
    category: "trivia",
    players: "1P+Kali",
  },
  {
    id: GameType.WORD_HINT,
    name: "Word Hint",
    icon: "\u{1F4DD}",
    description: "Guess the word from clues. Ask Kali for hints.",
    category: "trivia",
    players: "1P+Kali",
  },
];
