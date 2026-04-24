import type { Difficulty } from "./types";

const difficultyOrder: Difficulty[] = ["Easy", "Medium", "Hard"];

export function nextDifficulty(difficulty: Difficulty): Difficulty {
  return cycleDifficulty(difficulty, 1);
}

export function previousDifficulty(difficulty: Difficulty): Difficulty {
  return cycleDifficulty(difficulty, -1);
}

function cycleDifficulty(difficulty: Difficulty, step: 1 | -1): Difficulty {
  const index = difficultyOrder.indexOf(difficulty);
  return difficultyOrder[(index + step + difficultyOrder.length) % difficultyOrder.length] ?? "Easy";
}
