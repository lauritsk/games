import type { Difficulty } from "@shared/core";

export type WordleLetterState = "absent" | "present" | "correct";

export type WordleGuess = {
  word: string;
  evaluation: WordleLetterState[];
};

export type WordleConfig = {
  wordLength: number;
  maxGuesses: number;
  answers: readonly string[];
};

export const wordleAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export const wordleKeyboardRows = [
  "QWERTYUIOP".split(""),
  "ASDFGHJKL".split(""),
  "ZXCVBNM".split(""),
] as const;

export const wordleConfigs = {
  Easy: {
    wordLength: 4,
    maxGuesses: 6,
    answers: [
      "BIRD",
      "BOLD",
      "CAVE",
      "CLAY",
      "DUSK",
      "FIRE",
      "FROG",
      "GOLD",
      "HILL",
      "LIME",
      "MOON",
      "PINE",
      "RAIN",
      "ROCK",
      "SAND",
      "WAVE",
    ],
  },
  Medium: {
    wordLength: 5,
    maxGuesses: 6,
    answers: [
      "APPLE",
      "BRAIN",
      "CHAIR",
      "CLOUD",
      "CRANE",
      "DREAM",
      "EARTH",
      "FLAME",
      "GHOST",
      "HEART",
      "LIGHT",
      "MOUSE",
      "OCEAN",
      "PIANO",
      "PLANT",
      "RIVER",
      "SHARE",
      "STONE",
      "TIGER",
      "WATER",
    ],
  },
  Hard: {
    wordLength: 6,
    maxGuesses: 6,
    answers: [
      "BOTTLE",
      "BRIDGE",
      "CANDLE",
      "CASTLE",
      "DRAGON",
      "FOREST",
      "GALAXY",
      "GARDEN",
      "HARBOR",
      "JUNGLE",
      "ANCHOR",
      "MEADOW",
      "ORANGE",
      "PLANET",
      "POCKET",
      "ROCKET",
      "SILVER",
      "SPIRIT",
      "TEMPLE",
      "WINTER",
    ],
  },
} as const satisfies Record<Difficulty, WordleConfig>;

const stateRank = {
  absent: 1,
  present: 2,
  correct: 3,
} satisfies Record<WordleLetterState, number>;

export function pickWordleTarget(config: WordleConfig, random = Math.random): string {
  const index = Math.floor(random() * config.answers.length) % config.answers.length;
  return config.answers[index] ?? config.answers[0] ?? "WORDS";
}

export function normalizeWordleInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "");
}

export function isValidWordleGuess(word: string, config: WordleConfig): boolean {
  return /^[A-Z]+$/.test(word) && word.length === config.wordLength;
}

export function evaluateWordleGuess(guess: string, target: string): WordleLetterState[] {
  const normalizedGuess = normalizeWordleInput(guess);
  const normalizedTarget = normalizeWordleInput(target);
  const evaluation = Array.from<WordleLetterState>({ length: normalizedGuess.length }).fill(
    "absent",
  );
  const remaining = new Map<string, number>();

  for (let index = 0; index < normalizedTarget.length; index += 1) {
    const guessLetter = normalizedGuess[index];
    const targetLetter = normalizedTarget[index];
    if (!targetLetter) continue;
    if (guessLetter === targetLetter) {
      evaluation[index] = "correct";
      continue;
    }
    remaining.set(targetLetter, (remaining.get(targetLetter) ?? 0) + 1);
  }

  for (let index = 0; index < normalizedGuess.length; index += 1) {
    if (evaluation[index] === "correct") continue;
    const letter = normalizedGuess[index];
    if (!letter) continue;
    const count = remaining.get(letter) ?? 0;
    if (count <= 0) continue;
    evaluation[index] = "present";
    remaining.set(letter, count - 1);
  }

  return evaluation;
}

export function wordleKeyboardState(
  guesses: readonly WordleGuess[],
): Partial<Record<string, WordleLetterState>> {
  const states: Partial<Record<string, WordleLetterState>> = {};
  for (const guess of guesses) {
    for (let index = 0; index < guess.word.length; index += 1) {
      const letter = guess.word[index];
      const state = guess.evaluation[index];
      if (!letter || !state) continue;
      const existing = states[letter];
      if (!existing || stateRank[state] > stateRank[existing]) states[letter] = state;
    }
  }
  return states;
}
